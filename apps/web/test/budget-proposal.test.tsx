import { expect, it } from 'vitest';
import { BudgetProposal } from '../src/features/chat/budget-proposal';
import { renderUI } from './render';
import { agentChatReplySchema, type AgentBudgetProposal } from '@tcg/contracts';

const proposal: AgentBudgetProposal = { id: '00000000-0000-4000-8000-000000000001', policyId: '00000000-0000-4000-8000-000000000002', expectedVersion: 3, currency: 'tOKRW', previousTotalBudget: '100000000000000000000', previousMaxPerTrade: '25000000000000000000', totalBudget: '120000000000000000000', maxPerTrade: '10000000000000000000', spentAmount: '30000000000000000000', reservedAmount: '5000000000000000000', availableAmount: '85000000000000000000', signerMaxPerTrade: '25000000000000000000', expiresAt: '2099-01-01T00:00:00.000Z' };
it('변경 전후 예산·최신 금액 재검사·명시적 확인을 표시하고 스트림 DTO에 변경안을 보존한다', () => {
  expect(agentChatReplySchema.parse({ content: '확인해 주세요.', budgetProposal: proposal }).budgetProposal).toEqual(proposal);
  const html = renderUI(<BudgetProposal proposal={proposal} disabled={false} onAction={() => undefined} />);
  for (const text of ['100 tOKRW', '120 tOKRW', '85 tOKRW', '25 tOKRW', '확인하고 저장', '최신 지출', '5분']) expect(html).toContain(text);
  const applied = renderUI(<BudgetProposal proposal={proposal} disabled={false} onAction={() => undefined} result={{ proposalId: proposal.id, status: 'APPLIED', currency: 'tOKRW' }} />);
  expect(applied).toContain('저장했어요'); expect(applied).not.toContain('확인하고 저장');
});
