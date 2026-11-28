import { Usage, type Model } from '@openai/agents';
import { expect, it } from 'vitest';
import { createOpenAIBudgetConditionApi, normalizeBudgetCurrency } from '../src/budget.js';

it('현재 통화가 함께 명시된 전치 오타만 정규화한다', () => {
  expect(normalizeBudgetCurrency('총 예산 100tOKRW, 건당 예산 20tORKW', 'tOKRW')).toBe('총 예산 100tOKRW, 건당 예산 20tOKRW');
  for (const message of ['건당 20tORKW', '총 100KRW, 건당 20tORKW', '총 100tOKRW, 건당 20USD', '총 100tOKRW, 건당 20KRW', '총 100tOKRW, TORKWallet']) {
    expect(normalizeBudgetCurrency(message, 'tOKRW')).toBe(message);
  }
  expect(normalizeBudgetCurrency('총 100tOKRW, 건당 20tORKW', 'USDC')).toBe('총 100tOKRW, 건당 20tORKW');
});

it('사용자가 입력한 문장을 보정하여 구조화 모델에 전달하고 두 한도를 보존한다', async () => {
  const patch = { currency: 'tOKRW' as const, totalBudget: '100', maxPerTrade: '20' };
  let modelInput = '';
  const model: Model = {
    async getResponse(request) {
      modelInput = JSON.stringify(request.input);
      return { usage: new Usage(), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(patch) }] }] };
    },
    async *getStreamedResponse() { throw new Error('not used'); },
  };
  const api = createOpenAIBudgetConditionApi(model, 'tOKRW');
  expect(await api.extract('예산을 설정하자. 총 예산 100tOKRW, 건당 예산 20tORKW')).toEqual(patch);
  expect(modelInput).toContain('건당 예산 20tOKRW');
  expect(modelInput).not.toContain('tORKW');
});

it('명시적인 다른 통화는 자동 환산하거나 현재 통화로 대체하지 않는다', async () => {
  const model: Model = {
    async getResponse() { return { usage: new Usage(), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify({ currency: 'OTHER', totalBudget: '100', maxPerTrade: '20' }) }] }] }; },
    async *getStreamedResponse() { throw new Error('not used'); },
  };
  expect(await createOpenAIBudgetConditionApi(model, 'tOKRW').extract('총 예산 100tOKRW, 건당 예산 20KRW')).toBeNull();
});
