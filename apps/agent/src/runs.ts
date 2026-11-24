import { Readable } from 'node:stream';
import { AppError, agentRunInputSchema, idSchema, mutationContextSchema, type AgentRun, type AuthContext, type MutationContext, type TradingBuyer } from '@tcg/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

export interface ServerRunService {
  activeRuns?: () => Promise<{ run: AgentRun; auth: TradingBuyer }[]>;
  failRun?: (auth: TradingBuyer, id: string) => Promise<void>;
  startRun(auth: TradingBuyer, input: unknown, context: MutationContext): Promise<AgentRun>;
  getRun(auth: TradingBuyer, id: string): Promise<AgentRun>;
  listRuns(auth: TradingBuyer): Promise<AgentRun[]>;
  stopRun(auth: TradingBuyer, id: string): Promise<AgentRun>;
  recordResult(auth: TradingBuyer, id: string, result: string, completed?: boolean): Promise<AgentRun>;
}
export function createServerRunPlugin({ runs, requireAuth, execute }: {
  runs: ServerRunService;
  requireAuth(request: FastifyRequest): AuthContext;
  execute?: (run: AgentRun, auth: TradingBuyer, signal: AbortSignal) => Promise<{ result: string; completed: boolean }>;
}): FastifyPluginAsync {
  return async app => {
    const tasks = new Map<string, { controller: AbortController; done: Promise<void> }>();
    function buyer(request: FastifyRequest): TradingBuyer {
      const auth = requireAuth(request);
      if (!auth.agentId) throw new AppError('FORBIDDEN', '인증된 Agent가 필요합니다.', 403);
      return { userId: auth.userId, agentId: auth.agentId };
    }
    function launch(run: AgentRun, auth: TradingBuyer) {
      if (!execute || tasks.has(run.id) || run.status !== 'RUNNING') return;
      const controller = new AbortController();
      const remaining = Math.max(1, new Date(run.expiresAt).getTime() - Date.now());
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(remaining)]);
      // 정책 비활성화·기한 만료 등 다른 제어 경로도 실행 취소 신호로 전달한다.
      let checking = false;
      const control = setInterval(() => {
        if (checking || controller.signal.aborted) return;
        checking = true;
        void runs.getRun(auth, run.id).then(current => {
          if (current.status !== 'RUNNING' || new Date(current.expiresAt) <= new Date()) controller.abort();
        }).catch(error => app.log.error({ err: error }, 'Agent control status failed')).finally(() => { checking = false; });
      }, 1000);
      control.unref();
      const done = Promise.resolve().then(async () => {
        try {
          const output = await execute(run, auth, signal);
          if (!signal.aborted) await runs.recordResult(auth, run.id, output.result, output.completed);
        } catch (error) {
          app.log.error({ err: error }, 'Agent execution failed');
          if (!signal.aborted) { if (runs.failRun) await runs.failRun(auth, run.id); else await runs.recordResult(auth, run.id, '실행 오류가 발생했습니다. 상태를 확인하세요.'); }
        }
      }).catch(error => app.log.error({ err: error }, 'Agent result persistence failed')).finally(() => { clearInterval(control); tasks.delete(run.id); });
      tasks.set(run.id, { controller, done });
    }
    app.addHook('onListen', async () => { for (const active of await runs.activeRuns?.() ?? []) launch(active.run, active.auth); });
    app.post('/sessions', async (request, reply) => {
      const auth = buyer(request);
      const run = await runs.startRun(auth, agentRunInputSchema.parse(request.body), mutationContextSchema.parse({ idempotencyKey: request.headers['idempotency-key'] }));
      // 생성 응답 재시도로 이미 중단된 실행을 다시 시작하지 않는다.
      const current = await runs.getRun(auth, run.id);
      launch(current, auth);
      return reply.code(201).send(current);
    });
    app.get('/sessions', async request => runs.listRuns(buyer(request)));
    app.get('/sessions/:id', async request => {
      const auth = buyer(request), id = idSchema.parse((request.params as { id: string }).id);
      return runs.getRun(auth, id);
    });
    app.post('/sessions/:id/stop', async request => {
      const auth = buyer(request), id = idSchema.parse((request.params as { id: string }).id);
      const run = await runs.stopRun(auth, id);
      tasks.get(id)?.controller.abort();
      return run;
    });
    app.get('/sessions/:id/events', async (request, reply) => {
      const auth = buyer(request), id = idSchema.parse((request.params as { id: string }).id);
      await runs.getRun(auth, id);
      const subscriber = new AbortController();
      const onClose = () => subscriber.abort();
      reply.raw.once('close', onClose);
      async function* events() {
        let previous = '';
        try {
          while (!subscriber.signal.aborted) {
            const run = await runs.getRun(auth, id), snapshot = JSON.stringify(run);
            if (snapshot !== previous) { previous = snapshot; yield `event: status\ndata: ${snapshot}\n\n`; }
            if (run.status !== 'RUNNING') break;
            await new Promise<void>(resolve => {
              const wake = () => { clearTimeout(timer); subscriber.signal.removeEventListener('abort', wake); resolve(); };
              const timer = setTimeout(wake, 1000);
              subscriber.signal.addEventListener('abort', wake, { once: true });
              if (subscriber.signal.aborted) wake();
            });
          }
        } finally { reply.raw.off('close', onClose); }
      }
      return reply.type('text/event-stream').header('Cache-Control', 'no-cache').send(Readable.from(events()));
    });
    // 호스트 종료는 서버 실행의 종료가 아닌 인계다. DB 실행 상태와 결제 복구 기록은 유지한다.
    app.addHook('preClose', async () => { for (const task of tasks.values()) task.controller.abort(); await Promise.all([...tasks.values()].map(task => task.done)); });
  };
}
