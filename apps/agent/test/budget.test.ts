import { expect, it, vi } from 'vitest';
import { AppError } from '@tcg/contracts';
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
