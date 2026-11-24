import type { TradingExecutionContextReader } from '@tcg/contracts';
import { demoBuyerAgentId, demoBuyerId } from '../src/demo-auth.js';

export const testExecutionContext: TradingExecutionContextReader = {
  async getExecutionContext(auth) {
    if (auth.userId !== demoBuyerId || auth.agentId !== demoBuyerAgentId) return null;
    return { online: true, policy: { id: '00000000-0000-4000-8004-000000000001', version: 1, agentId: auth.agentId, enabled: true, maxPerTrade: '100000000', totalBudget: '100000000', validUntil: '2099-01-01T00:00:00.000Z' } };
  },
};
