import { Usage, type Model } from '@openai/agents';
import { expect, it, vi } from 'vitest';
import type { PurchaseCondition } from '@tcg/contracts';
import { createAgentRuntime, createOpenAIPurchaseConditionApi } from '../src/index.js';

const condition: PurchaseCondition = { cardQuery: '피카츄 SV 025 EN NM', strategy: 'LIMIT', maxPrice: '12500000', minDiscountPercent: 15 };
const aggregatorService = { searchCards: vi.fn(async () => []) };
const valuationService = { getValuation: vi.fn() };
const decisionApi = { classify: vi.fn(async () => ({ route: 'prepare_purchase' as const, language: 'ko' as const })) };

function responseModel(output: unknown): Model {
  return {
    async getResponse() { return { usage: new Usage(), output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }] }; },
    async *getStreamedResponse() { throw new Error('not used'); },
  };
}

it('구조화 출력 모델의 구매 조건을 해석해 Mock 구매 도구에 정확히 전달한다', async () => {
  const preview = vi.fn(async (value: PurchaseCondition) => ({ mode: 'MOCK' as const, condition: value }));
  const runtime = createAgentRuntime({
    aggregatorService, valuationService, decisionApi,
    purchaseConditionApi: createOpenAIPurchaseConditionApi(responseModel({ condition })),
    purchasePreviewTool: { preview },
  });
  const result = await runtime.runAgentTurn('피카츄 SV 025 EN NM을 12.5 USDC 이하, 적정가보다 15% 이상 저렴할 때 지정가 매수해줘');
  expect(preview).toHaveBeenCalledExactlyOnceWith(condition);
  expect(result).toContain('12.5 USDC');
  expect(result).toContain('최소 할인율 15%');
  expect(result).toContain('주문·예약·결제는 실행하지 않았습니다');
});

it('카드나 건당 상한이 불명확하면 구매 도구를 호출하지 않고 확인한다', async () => {
  const preview = vi.fn();
  const runtime = createAgentRuntime({ aggregatorService, valuationService, decisionApi,
    purchaseConditionApi: createOpenAIPurchaseConditionApi(responseModel({ condition: null })), purchasePreviewTool: { preview },
  });
  expect(await runtime.runAgentTurn('피카츄 구매해줘')).toContain('카드 1장당 최대 가격');
  expect(preview).not.toHaveBeenCalled();
});

it('잘못된 금액과 조건을 바꾼 Mock 도구 결과를 거부한다', async () => {
  const preview = vi.fn(async () => ({ mode: 'MOCK' as const, condition: { ...condition, maxPrice: '99999999999' } }));
  const invalid = createAgentRuntime({ aggregatorService, valuationService, decisionApi,
    purchaseConditionApi: createOpenAIPurchaseConditionApi(responseModel({ condition: { ...condition, maxPrice: '12.5' } })), purchasePreviewTool: { preview },
  });
  await expect(invalid.runAgentTurn('피카츄 구매해줘')).rejects.toThrow();
  expect(preview).not.toHaveBeenCalled();
  const changed = createAgentRuntime({ aggregatorService, valuationService, decisionApi,
    purchaseConditionApi: { async extract() { return condition; } }, purchasePreviewTool: { preview },
  });
  await expect(changed.runAgentTurn('피카츄 12.5 USDC 이하로 구매해줘')).rejects.toThrow('다른 결과');
});
