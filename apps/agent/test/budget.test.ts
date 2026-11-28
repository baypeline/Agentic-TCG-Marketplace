import { expect, it, vi } from 'vitest';
import { AppError } from '@tcg/contracts';
import type { AgentBudgetProposal } from '@tcg/contracts';
import { createAgentRuntime } from '../src/index.js';
it('예산 경로는 조회·구매 도구를 실행하지 않고 추출한 변경안만 전달한다', async () => {
  const searchCards = vi.fn(), getValuation = vi.fn();
  const extract = vi.fn(async () => ({ currency: 'tOKRW' as const, totalBudget: '100', maxPerTrade: null }));
  const runtime = createAgentRuntime({ decisionApi: { classify: async () => ({ route: 'update_budget', language: 'ko' }) }, budgetConditionApi: { extract }, aggregatorService: { searchCards }, valuationService: { getValuation } });
  const onBudgetChange = vi.fn(async () => { throw new AppError('BUDGET_EXCEEDED', '이미 사용한 예산보다 낮출 수 없습니다.', 409); });
  expect(await runtime.runAgentTurn('예산을 100으로', { onBudgetChange })).toContain('낮출 수 없습니다');
  expect(onBudgetChange).toHaveBeenCalledExactlyOnceWith({ currency: 'tOKRW', totalBudget: '100', maxPerTrade: null });
  expect(searchCards).not.toHaveBeenCalled(); expect(getValuation).not.toHaveBeenCalled();
  expect(await runtime.runAgentTurn('예산을 100으로')).toContain('연결되어 있지');
  extract.mockResolvedValueOnce(null!);
  expect(await runtime.runAgentTurn('예산을 바꿔줘', { onBudgetChange })).toContain('총예산이나 건당');
  expect(onBudgetChange).toHaveBeenCalledTimes(1);
});

it('오타를 해석한 예산 변경안은 보정 안내와 확인 요청을 함께 표시한다', async () => {
  const onBudgetChange = vi.fn(async () => ({} as AgentBudgetProposal));
  const runtime = createAgentRuntime({
    decisionApi: { classify: async () => ({ route: 'update_budget', language: 'ko' }) },
    budgetConditionApi: { extract: async () => ({ currency: 'tOKRW', totalBudget: '100', maxPerTrade: '20' }) },
    aggregatorService: { searchCards: vi.fn() }, valuationService: { getValuation: vi.fn() },
    marketplaceService: { paymentReady: true, paymentChain: 'maroo', listListings: vi.fn() },
  });
  const reply = await runtime.runAgentTurn('예산을 설정하자. 총 예산 100tOKRW, 건당 예산 20tORKW', { onBudgetChange });
  expect(onBudgetChange).toHaveBeenCalledExactlyOnceWith({ currency: 'tOKRW', totalBudget: '100', maxPerTrade: '20' });
  expect(reply).toContain('tORKW는 같은 문장에 적힌 tOKRW로 해석');
  expect(reply).toContain('확인하고 저장');
});
