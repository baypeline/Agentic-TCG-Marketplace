import { randomUUID } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { AppError, idSchema, agentChatReplySchema, agentPurchaseInputSchema, agentPurchaseProgressSchema, type AuthContext, type CardVariant, type AgentPurchaseOffer, type AgentPurchaseInput, type AgentPurchaseProgress } from '@tcg/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgentMessage, AgentTurnOptions } from './turn.js';
import { agentBudgetActionSchema, agentBudgetProposalSchema, agentBudgetResultSchema, type AgentBudgetPatch, type AgentBudgetProposal, type AgentBudgetResult } from '@tcg/contracts';

export interface AgentSessionPluginOptions {
  runtime: {
    runAgentTurn(message: string, options?: AgentTurnOptions): Promise<string>;
  };
  requireAuth(request: FastifyRequest): AuthContext;
  onSessionStarted?: (auth: AuthContext, sessionId: string) => Promise<void>;
  // 호스트는 먼저 online 상태를 해제한 뒤 Trading.pauseAgentOrders를 호출한다.
  onSessionStopped?: (auth: AuthContext, sessionId: string) => Promise<void>;
  purchase?: (input: AgentPurchaseInput & { offer: AgentPurchaseOffer; auth: AuthContext; sessionId: string }) => Promise<AgentPurchaseProgress>;
  budget?: { propose(patch: AgentBudgetPatch): Promise<AgentBudgetProposal>; confirm(proposal: AgentBudgetProposal): Promise<AgentBudgetResult> };
}

interface AgentSession {
  id: string;
  userId: string;
  agentId?: string;
  updatedAt: number;
  messages: AgentMessage[];
  busy: boolean;
  stopped: boolean;
  stopNotified: boolean;
  stopTask?: Promise<void>;
  controller?: AbortController;
  purchases: Map<string, { offer: AgentPurchaseOffer; tasks: Map<string, Promise<AgentPurchaseProgress>>; recorded: boolean }>;
  budgetProposal?: AgentBudgetProposal;
  budgetResult?: AgentBudgetResult;
}

const sessionParamsSchema = z.object({ sessionId: idSchema });
const messageBodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

const sessionTtlMs = 60 * 60 * 1000;
const maxSessions = 1000;
const maxHistoryMessages = 24;
const turnTimeoutMs = 60_000;

function sse(event: 'started' | 'delta' | 'completed' | 'error', data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createAgentSessionPlugin({ runtime, requireAuth, onSessionStarted, onSessionStopped, purchase, budget }: AgentSessionPluginOptions): FastifyPluginAsync {
  return async app => {
    const sessions = new Map<string, AgentSession>();

    async function getSession(request: FastifyRequest) {
      const auth = requireAuth(request);
      const params = sessionParamsSchema.safeParse(request.params);
      if (!params.success) throw new AppError('VALIDATION_ERROR', '세션 ID 형식을 확인하세요.', 400);
      const { sessionId } = params.data;
      const session = sessions.get(sessionId);
      if (!session || session.userId !== auth.userId || session.agentId !== auth.agentId) {
        throw new AppError('SESSION_NOT_FOUND', '에이전트 세션을 찾을 수 없습니다.', 404);
      }
      if (!session.busy && Date.now() - session.updatedAt >= sessionTtlMs) {
        await stopSession(session);
        sessions.delete(sessionId);
        throw new AppError('SESSION_NOT_FOUND', '에이전트 세션을 찾을 수 없습니다.', 404);
      }
      return session;
    }

    async function stopSession(session: AgentSession) {
      session.stopped = true;
      session.controller?.abort();
      if (!session.stopNotified) {
        session.stopTask ??= Promise.resolve()
          .then(() => onSessionStopped?.({ userId: session.userId, ...(session.agentId ? { agentId: session.agentId } : {}) }, session.id))
          .then(() => { session.stopNotified = true; })
          .finally(() => { session.stopTask = undefined; });
        await session.stopTask;
      }
    }

    async function expireSessions() {
      for (const [id, session] of sessions) {
        if (!session.busy && Date.now() - session.updatedAt >= sessionTtlMs) {
          await stopSession(session);
          sessions.delete(id);
        }
      }
    }
    let cleanup: Promise<void> | undefined;
    const timer = setInterval(() => {
      if (cleanup) return;
      cleanup = expireSessions().catch(error => app.log.error({ err: error }, 'Agent session cleanup failed')).finally(() => { cleanup = undefined; });
    }, 60_000);
    timer.unref();
    app.addHook('preClose', async () => {
      clearInterval(timer);
      await cleanup;
      await Promise.all([...sessions.values()].map(stopSession));
    });

    app.post('/agent/sessions', async (request, reply) => {
      const auth = requireAuth(request);
      const now = Date.now();
      await expireSessions();
      if (sessions.size >= maxSessions) {
        throw new AppError('INTERNAL_ERROR', '새 세션을 생성할 수 없습니다.', 503, true);
      }

      const id = randomUUID();
      const messages: AgentMessage[] = [];
      await onSessionStarted?.(auth, id);
      sessions.set(id, { id, userId: auth.userId, agentId: auth.agentId, updatedAt: now, messages, busy: false, stopped: false, stopNotified: false, purchases: new Map() });
      return reply.code(201).send({ id, messages });
    });

    app.get('/agent/sessions/:sessionId', async request => {
      const session = await getSession(request);
      return { id: session.id, messages: session.messages, status: session.stopped ? 'STOPPED' : 'RUNNING' };
    });

    app.post('/agent/sessions/:sessionId/stop', async request => {
      const session = await getSession(request);
      await stopSession(session);
      return { id: session.id, status: 'STOPPED' };
    });

    if (purchase) app.post('/agent/sessions/:sessionId/purchases', async request => {
      const session = await getSession(request);
      const input = agentPurchaseInputSchema.parse(request.body);
      if (session.stopped && !['status', 'cancel'].includes(input.action)) throw new AppError('POLICY_VIOLATION', '중단된 세션에서는 구매할 수 없습니다.', 409);
      let state = session.purchases.get(input.requestId);
      if (state && state.offer.listingId !== input.listingId) throw new AppError('IDEMPOTENCY_CONFLICT', '같은 구매 요청에 다른 매물을 사용할 수 없습니다.', 409);
      if (!state) {
        if (input.action !== 'prepare') throw new AppError('VALIDATION_ERROR', '구매 준비 요청이 필요합니다.', 400);
        const offer = session.messages.flatMap(message => message.purchaseOffers ?? []).find(item => item.listingId === input.listingId);
        if (!offer) throw new AppError('FORBIDDEN', '이 대화에서 안내한 매물만 구매할 수 있습니다.', 403);
        if (session.purchases.size >= 100) throw new AppError('POLICY_VIOLATION', '새 대화에서 구매를 진행해 주세요.', 409);
        state = { offer, tasks: new Map(), recorded: false };
        session.purchases.set(input.requestId, state);
      }
      const cached = input.action !== 'status' ? state.tasks.get(input.action) : undefined;
      if (cached) return cached;
      if (session.busy) throw new AppError('SESSION_BUSY', '이전 요청을 처리 중입니다.', 409, true);
      session.busy = true;
      const current = state;
      const task = (async () => {
        try {
          const result = agentPurchaseProgressSchema.parse(await purchase({ ...input, offer: current.offer, auth: { userId: session.userId, ...(session.agentId ? { agentId: session.agentId } : {}) }, sessionId: session.id }));
          if (result.status === 'COMPLETED' && !current.recorded) {
            current.recorded = true;
            session.messages = [...session.messages, { role: 'assistant' as const, content: `${current.offer.card.name} 구매가 완료되었습니다. 카드가 구매자에게 이전되었으며 Base Sepolia 테스트 USDC 결제가 정산되었습니다. 거래 ID: ${result.tradeId}` }].slice(-maxHistoryMessages);
          }
          session.updatedAt = Date.now();
          return result;
        } catch (error) { current.tasks.delete(input.action); throw error; }
        finally { session.busy = false; }
      })();
      if (input.action !== 'status') current.tasks.set(input.action, task);
      return task;
    });

    if (budget) app.post('/agent/sessions/:sessionId/budget', async request => {
      const session = await getSession(request);
      const input = agentBudgetActionSchema.parse(request.body);
      const proposal = session.budgetProposal;
      if (!proposal || proposal.id !== input.proposalId) throw new AppError('FORBIDDEN', '이 대화의 최신 예산 변경안만 처리할 수 있습니다.', 403);
      if (session.budgetResult) {
        if ((session.budgetResult.status === 'APPLIED') !== (input.action === 'confirm')) throw new AppError('IDEMPOTENCY_CONFLICT', '이미 처리한 변경안입니다.', 409);
        return session.budgetResult;
      }
      if (session.stopped) throw new AppError('POLICY_VIOLATION', '중단된 대화에서는 예산을 변경할 수 없습니다.', 409);
      if (session.busy) throw new AppError('SESSION_BUSY', '이전 요청을 처리 중입니다.', 409, true);
      session.busy = true;
      try {
        const result = agentBudgetResultSchema.parse(input.action === 'confirm' ? await budget.confirm(proposal) : { proposalId: proposal.id, status: 'CANCELLED', currency: proposal.currency });
        session.budgetResult = result;
        session.updatedAt = Date.now();
        session.messages.push({ role: 'assistant', content: result.status === 'APPLIED' ? '사용자가 확인한 예산 변경을 서버에 저장했습니다. 지출과 결제 예약 내역은 유지됩니다.' : '예산 변경을 취소했습니다.' });
        session.messages = session.messages.slice(-maxHistoryMessages);
        return result;
      } finally { session.busy = false; }
    });

    app.post('/agent/sessions/:sessionId/messages', async (request, reply) => {
      const session = await getSession(request);
      if (session.stopped) throw new AppError('POLICY_VIOLATION', '중단된 세션에서는 신규 실행을 할 수 없습니다.', 409);
      const body = messageBodySchema.safeParse(request.body);
      if (!body.success) throw new AppError('VALIDATION_ERROR', '1~4000자의 메시지를 입력해 주세요.', 400);
      const { message } = body.data;
      if (session.busy) {
        throw new AppError('SESSION_BUSY', '이 세션에서 이미 요청을 처리 중입니다.', 409, true);
      }
      session.busy = true;

      const execution = new AbortController();
      session.controller = execution;
      const signal = AbortSignal.any([execution.signal, AbortSignal.timeout(turnTimeoutMs)]);
      const stream = new PassThrough();
      async function emit(event: 'delta' | 'completed' | 'error', data: object) {
        if (stream.destroyed || stream.writableEnded) return;
        if (!stream.write(sse(event, data)) && !stream.destroyed && !signal.aborted) {
          // 느린 독자에는 역압을 적용하고 연결 종료·실행 중단 시 기다림을 해제한다.
          await new Promise<void>(resolve => {
            const done = () => {
              stream.off('drain', done); stream.off('close', done);
              signal.removeEventListener('abort', done); resolve();
            };
            stream.once('drain', done); stream.once('close', done);
            signal.addEventListener('abort', done, { once: true });
            if (stream.destroyed || signal.aborted) done();
          });
        }
      }
      stream.write(sse('started', { sessionId: session.id }));
      // 서버가 작업 Promise를 소유한다. 조회 스트림의 수명으로 취소하지 않는다.
      void (async () => {
        try {
          let cardChoices: CardVariant[] = [];
          let purchaseOffers: AgentPurchaseOffer[] = [];
          let budgetProposal: AgentBudgetProposal | undefined;
          const output = await runtime.runAgentTurn(message, { history: session.messages, signal,
            onCardChoices: cards => { cardChoices = cards; },
            onPurchaseOffers: offers => { purchaseOffers = offers.length ? [...purchaseOffers.filter(old => !offers.some(offer => offer.card.id === old.card.id)), ...offers].slice(0, 10) : []; },
            ...(budget ? { onBudgetChange: async (patch: AgentBudgetPatch) => {
              budgetProposal = agentBudgetProposalSchema.parse(await budget.propose(patch));
              return budgetProposal;
            } } : {}),
            onTextDelta: delta => emit('delta', { delta }),
          });
          signal.throwIfAborted();
          // A completed new turn invalidates earlier confirmation buttons, including plain text follow-ups.
          session.budgetProposal = budgetProposal;
          session.budgetResult = undefined;
          const assistantMessage: AgentMessage = { role: 'assistant', ...agentChatReplySchema.parse({ content: output, ...(cardChoices.length ? { cardChoices } : {}), ...(purchaseOffers.length ? { purchaseOffers } : {}), ...(budgetProposal ? { budgetProposal } : {}) }) };
          session.messages = [...session.messages, { role: 'user', content: message } satisfies AgentMessage, assistantMessage].slice(-maxHistoryMessages);
          session.updatedAt = Date.now();
          await emit('completed', { sessionId: session.id, message: assistantMessage });
        } catch (error) {
          request.log.error({ err: error }, 'Agent turn failed');
          await emit('error', { code: 'INTERNAL_ERROR', message: '에이전트 응답을 완료하지 못했습니다.', retryable: true, requestId: request.id });
        } finally { session.busy = false; session.controller = undefined; stream.end(); }
      })();

      return reply
        .type('text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .header('X-Accel-Buffering', 'no')
        .send(stream);
    });
  };
}
