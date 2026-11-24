import type { TradingExecutionContextReader } from '@tcg/contracts';

// 기존 거래 흐름 테스트에만 쓰는 명시적 승인 정책. 실행 서버에서는 사용하지 않는다.
export const allowExecution: TradingExecutionContextReader = {
  async getExecutionContext({ agentId }) {
    return { online: true, policy: { id: '00000000-0000-4000-8004-000000000001', version: 1, agentId, enabled: true, totalBudget: '1000000000000', maxPerTrade: '1000000000000', validUntil: '2099-01-01T00:00:00.000Z' } };
  },
};
