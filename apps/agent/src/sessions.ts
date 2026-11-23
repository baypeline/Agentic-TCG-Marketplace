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
}

interface AgentSession {
  id: string;
  userId: string;
  agentId?: string;
  updatedAt: number;
  messages: AgentMessage[];
  busy: boolean;
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

export function createAgentSessionPlugin({ runtime, requireAuth }: AgentSessionPluginOptions): FastifyPluginAsync {
  return async app => {
    const sessions = new Map<string, AgentSession>();

    function getSession(request: FastifyRequest) {
      const auth = requireAuth(request);
      const params = sessionParamsSchema.safeParse(request.params);
      if (!params.success) throw new AppError('VALIDATION_ERROR', '세션 ID 형식을 확인하세요.', 400);
      const { sessionId } = params.data;
      const session = sessions.get(sessionId);
      if (!session || session.userId !== auth.userId || session.agentId !== auth.agentId) {
        throw new AppError('SESSION_NOT_FOUND', '에이전트 세션을 찾을 수 없습니다.', 404);
      }
      if (!session.busy && Date.now() - session.updatedAt >= sessionTtlMs) {
        sessions.delete(sessionId);
        throw new AppError('SESSION_NOT_FOUND', '에이전트 세션을 찾을 수 없습니다.', 404);
      }
      return session;
    }

    app.post('/agent/sessions', async (request, reply) => {
      const auth = requireAuth(request);
      const now = Date.now();
      for (const [id, session] of sessions) {
        if (!session.busy && now - session.updatedAt >= sessionTtlMs) sessions.delete(id);
      }
      if (sessions.size >= maxSessions) {
        throw new AppError('INTERNAL_ERROR', '새 세션을 생성할 수 없습니다.', 503, true);
      }

      const id = randomUUID();
      const messages: AgentMessage[] = [];
      sessions.set(id, { id, userId: auth.userId, agentId: auth.agentId, updatedAt: now, messages, busy: false });
      return reply.code(201).send({ id, messages });
    });

    app.get('/agent/sessions/:sessionId', async request => {
      const session = getSession(request);
      return { id: session.id, messages: session.messages };
    });

    app.post('/agent/sessions/:sessionId/messages', async (request, reply) => {
      const session = getSession(request);
      const body = messageBodySchema.safeParse(request.body);
      if (!body.success) throw new AppError('VALIDATION_ERROR', '1~4000자의 메시지를 입력해 주세요.', 400);
      const { message } = body.data;
      if (session.busy) {
        throw new AppError('SESSION_BUSY', '이 세션에서 이미 요청을 처리 중입니다.', 409, true);
      }
      session.busy = true;

      const disconnect = new AbortController();
      const onClose = () => disconnect.abort();
      reply.raw.once('close', onClose);
      const signal = AbortSignal.any([disconnect.signal, AbortSignal.timeout(turnTimeoutMs)]);

      async function* events() {
        try {
          yield sse('started', { sessionId: session.id });
          const output = await runtime.runAgentTurn(message, { history: session.messages, signal });
          signal.throwIfAborted();

          const assistantMessage: AgentMessage = { role: 'assistant', content: output };
          session.messages = [
            ...session.messages,
            { role: 'user', content: message } satisfies AgentMessage,
            assistantMessage,
          ].slice(-maxHistoryMessages);
          session.updatedAt = Date.now();
          yield sse('completed', { sessionId: session.id, message: assistantMessage });
        } catch (error) {
          if (!disconnect.signal.aborted) {
            request.log.error({ err: error }, 'Agent turn failed');
            yield sse('error', {
              code: 'INTERNAL_ERROR',
              message: '에이전트 응답을 완료하지 못했습니다.',
              retryable: true,
              requestId: request.id,
            });
          }
        } finally {
          reply.raw.off('close', onClose);
          session.busy = false;
        }
      }

      return reply
        .type('text/event-stream; charset=utf-8')
        .header('Cache-Control', 'no-cache, no-transform')
        .send(Readable.from(events()));
    });
  };
}
