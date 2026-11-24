import { AppError, spendingPolicySchema, tradingBuyerSchema, type AuthContext, type SpendingPolicy, type TradingBuyer, type TradingExecutionContextReader } from '@tcg/contracts';

export interface AgentExecutionOptions {
  // 클라이언트 입력이 아닌 서버 측 승인 정책 저장소를 조회한다.
  resolvePolicy(auth: TradingBuyer): Promise<SpendingPolicy | null>;
  pauseOrders(auth: TradingBuyer): Promise<unknown>;
  now?: () => Date;
}

/** 단일 호스트의 Agent 세션과 Trading 실행 권한을 연결한다. */
export function createAgentExecutionController({ resolvePolicy, pauseOrders, now = () => new Date() }: AgentExecutionOptions) {
  const states = new Map<string, { sessions: Set<string> }>();
  const queues = new Map<string, Promise<unknown>>();
  const key = (auth: TradingBuyer) => `${auth.userId}:${auth.agentId}`;
  function serial<T>(auth: TradingBuyer, work: () => Promise<T>): Promise<T> {
    const id = key(auth);
    const task = (queues.get(id) ?? Promise.resolve()).catch(() => {}).then(work);
    queues.set(id, task);
    void task.finally(() => { if (queues.get(id) === task) queues.delete(id); }).catch(() => {});
    return task;
  }
  async function getPolicy(auth: TradingBuyer) {
    const parsed = spendingPolicySchema.safeParse(await resolvePolicy(auth));
    if (!parsed.success || parsed.data.agentId !== auth.agentId || !parsed.data.enabled || new Date(parsed.data.validUntil) <= now()) return null;
    return parsed.data;
  }
  const executionContext: TradingExecutionContextReader = {
    async getExecutionContext(input) {
      const auth = tradingBuyerSchema.parse(input);
      if (!states.get(key(auth))?.sessions.size) return null;
      const policy = await getPolicy(auth);
      // 정책 조회 중 세션이 중단되었을 수도 있으므로 다시 확인한다.
      return policy && states.get(key(auth))?.sessions.size ? { online: true, policy } : null;
    },
  };
  return {
    executionContext,
    async onSessionStarted(input: AuthContext, sessionId: string) {
      const auth = tradingBuyerSchema.parse(input);
      return serial(auth, async () => {
        if (!await getPolicy(auth)) throw new AppError('POLICY_VIOLATION', '유효한 서버 측 승인 정책이 필요합니다.', 409);
        const state = states.get(key(auth)) ?? { sessions: new Set<string>() };
        state.sessions.add(sessionId);
        states.set(key(auth), state);
      });
    },
    async onSessionStopped(input: AuthContext, sessionId: string) {
      const auth = tradingBuyerSchema.parse(input);
      return serial(auth, async () => {
        const state = states.get(key(auth));
        if (!state) return;
        state.sessions.delete(sessionId);
        if (state.sessions.size) return;
        // 먼저 offline으로 보이게 한 뒤 미제출 주문을 정리한다. 실패 시 빈 상태를 남겨 재시도한다.
        await pauseOrders(auth);
        states.delete(key(auth));
      });
    },
  };
}
