import { expect, it } from 'vitest';
import { renderUI } from './render';
import { BudgetOverview } from '../src/features/trading/agent-budget-settings';
import { agentBudgetStateSchema } from '@tcg/contracts';
it('실제 정책의 예산·지출·예약과 건당 한도를 표시한다', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const state = agentBudgetStateSchema.parse({ policy: { id, agentId: id, version: 3, enabled: true, totalBudget: '100000000000000000000', maxPerTrade: '20000000000000000000', validUntil: '2099-01-01T00:00:00Z' }, budget: { policyId: id, totalBudget: '100000000000000000000', spentAmount: '5000000000000000000', reservedAmount: '1000000000000000000', availableAmount: '94000000000000000000' }, currency: 'tOKRW', signerMaxPerTrade: '25000000000000000000' });
  const html = renderUI(<BudgetOverview state={state} />);
  for (const text of ['현재 적용 중인 예산', '94 tOKRW', '20 tOKRW', '100 tOKRW', '5 tOKRW', '1 tOKRW', '구매 허용']) expect(html).toContain(text);
  expect(html).not.toContain('25 tOKRW');
});
