import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { AppError, idSchema, type AuthContext } from '@tcg/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { z } from 'zod';
import type { AgentMessage, AgentTurnOptions } from './turn.js';

export interface AgentSessionPluginOptions {
  runtime: {
    runAgentTurn(message: string, options?: AgentTurnOptions): Promise<string>;
  };
  requireAuth(request: FastifyRequest): AuthContext;
  onSessionStarted?: (auth: AuthContext, sessionId: string) => Promise<void>;
  // 호스트는 먼저 online 상태를 해제한 뒤 Trading.pauseAgentOrders를 호출한다.
  onSessionStopped?: (auth: AuthContext, sessionId: string) => Promise<void>;
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
}

const sessionParamsSchema = z.object({ sessionId: idSchema });
const messageBodySchema = z.object({ message: z.string().trim().min(1).max(4000) });

const sessionTtlMs = 60 * 60 * 1000;
const maxSessions = 1000;
const maxHistoryMessages = 24;
const turnTimeoutMs = 60_000;

function sse(event: 'started' | 'completed' | 'error', data: object): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function createAgentSessionPlugin({ runtime, requireAuth, onSessionStarted, onSessionStopped }: AgentSessionPluginOptions): FastifyPluginAsync {
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
      sessions.set(id, { id, userId: auth.userId, agentId: auth.agentId, updatedAt: now, messages, busy: false, stopped: false, stopNotified: false });
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
      // 서버가 작업 Promise를 소유한다. 조회 스트림의 수명으로 취소하지 않는다.
      const task = (async () => {
        try {
          const output = await runtime.runAgentTurn(message, { history: session.messages, signal });
          signal.throwIfAborted();
          const assistantMessage: AgentMessage = { role: 'assistant', content: output };
          session.messages = [...session.messages, { role: 'user', content: message } satisfies AgentMessage, assistantMessage].slice(-maxHistoryMessages);
          session.updatedAt = Date.now();
          return sse('completed', { sessionId: session.id, message: assistantMessage });
        } catch (error) {
          request.log.error({ err: error }, 'Agent turn failed');
          return sse('error', { code: 'INTERNAL_ERROR', message: '에이전트 응답을 완료하지 못했습니다.', retryable: true, requestId: request.id });
        } finally { session.busy = false; session.controller = undefined; }
      })();
      async function* events() {
        yield sse('started', { sessionId: session.id });
        yield await task;
      }

      return reply
        .type('text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .send(Readable.from(events()));
    });
  };
}
