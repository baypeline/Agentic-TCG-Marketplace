import { Usage, type Model, type ModelRequest, type ModelResponse } from '@openai/agents';
import { createAggregatorService, createMockCardAdapter, mockCards } from '@tcg/aggregator';
import { createMockPriceAdapter, createValuationService } from '@tcg/valuation';
import { expect, it, vi } from 'vitest';
import { createAgentRuntime, type IntentDecision } from '../src/index.js';

type ModelOutput = ModelResponse['output'][number];

function toolCall(name: string, args: object, callId: string): ModelOutput {
  return { type: 'function_call', name, callId, arguments: JSON.stringify(args) };
}

function reply(text: string): ModelOutput {
  return { type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text }] };
}

function setup(route: IntentDecision['route'], ...steps: ((request: ModelRequest) => ModelOutput)[]) {
  const model: Model = {
    getResponse: vi.fn(async (request) => {
      const next = steps.shift();
      if (!next) throw new Error('예상하지 못한 모델 호출입니다.');
      return { output: [next(request)], usage: new Usage() };
    }),
    async *getStreamedResponse() {
      throw new Error('스트리밍 응답은 이 테스트에서 사용하지 않습니다.');
    },
  };
  const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
  const valuationService = createValuationService({ aggregatorService, adapter: createMockPriceAdapter() });
  const searchCards = vi.spyOn(aggregatorService, 'searchCards');
  const getValuation = vi.spyOn(valuationService, 'getValuation');
  const classify = vi.fn(async (): Promise<IntentDecision> => ({ route, language: 'ko' }));
  const runtime = createAgentRuntime({ aggregatorService, valuationService, model, decisionApi: { classify } });
  return { runtime, model, classify, searchCards, getValuation };
}

function toolResult(request: ModelRequest, callId: string) {
  if (!Array.isArray(request.input)) throw new Error('도구 결과가 모델 입력에 없습니다.');
  const result = request.input.find(item => item.type === 'function_call_result' && item.callId === callId);
  if (result?.type !== 'function_call_result') {
    throw new Error(`도구 호출 ${callId}의 JSON 결과가 없습니다.`);
  }
  const { output } = result;
  if (typeof output === 'string') return JSON.parse(output) as unknown;
  if (!Array.isArray(output) && output.type === 'text') return JSON.parse(output.text) as unknown;
  throw new Error(`도구 호출 ${callId}의 결과가 텍스트 형식이 아닙니다.`);
}

it('조회한 후보만 선택 UI로 전달하고 기존 문자열 응답을 유지한다', async () => {
  const first = mockCards[0]!;
  const second = { ...first, id: '00000000-0000-4000-8000-000000000099', setCode: 'base2' };
  const onCardChoices = vi.fn();
  const { runtime, searchCards } = setup('get_valuation',
    () => toolCall('search_cards', { query: 'Pikachu' }, 'search'),
    () => toolCall('show_card_choices', { cardVariantIds: [second.id, first.id] }, 'choices'),
    request => {
      expect(toolResult(request, 'choices')).toEqual({ displayedCardIds: [second.id, first.id] });
      return reply('아래 카드에서 선택해 주세요.');
    },
  );
  searchCards.mockResolvedValue([first, second]);
  await expect(runtime.runAgentTurn('피카츄 시세 알려줘', { onCardChoices })).resolves.toBe('아래 카드에서 선택해 주세요.');
  expect(onCardChoices).toHaveBeenCalledExactlyOnceWith([second, first]);
});

it('이번 턴에 조회하지 않은 카드 ID는 선택 버튼으로 내보내지 않는다', async () => {
  const onCardChoices = vi.fn();
  const { runtime } = setup('search_cards',
    () => toolCall('show_card_choices', { cardVariantIds: [mockCards[0]!.id] }, 'choices'),
    () => reply('먼저 카드를 검색해 주세요.'),
  );
  await runtime.runAgentTurn('피카츄 찾아줘', { onCardChoices });
  expect(onCardChoices).not.toHaveBeenCalled();
});

it('빈 한국어 검색 후 영문 이름으로 찾은 카드의 Mock 적정가를 모델에 전달한다', async () => {
  const pikachu = mockCards[0]!;
  const answer = 'Pikachu SV 025 EN NORMAL NM의 시연용 Mock 적정가는 12 USDC입니다.';
  const { runtime, searchCards, getValuation } = setup('get_valuation',
    request => {
      expect(request.tools.map(tool => tool.name)).toEqual(['search_cards', 'get_valuation']);
      return toolCall('search_cards', { query: '피카츄' }, 'ko');
    },
    request => {
      expect(toolResult(request, 'ko')).toEqual({ items: [], nextCursor: null });
      return toolCall('search_cards', { query: 'Pikachu' }, 'en');
    },
    request => {
      expect(toolResult(request, 'en')).toEqual({ items: [pikachu], nextCursor: null });
      return toolCall('get_valuation', { cardVariantId: pikachu.id }, 'price');
    },
    request => {
      expect(toolResult(request, 'price')).toMatchObject({
        cardVariantId: pikachu.id,
        dataSource: 'MOCK',
        status: 'AVAILABLE',
        estimatedPrice: '12000000',
      });
      return reply(answer);
    },
  );

  // 한국어 검색도 지원하는 현재 Mock과 별개로, 빈 응답의 대체 검색 경로를 재현한다.
  searchCards.mockResolvedValueOnce([]);
  await expect(runtime.runAgentTurn('피카츄 적정가 알려줘')).resolves.toBe(answer);
  expect(searchCards.mock.calls).toEqual([
    [{ query: '피카츄', limit: 10 }],
    [{ query: 'Pikachu', limit: 10 }],
  ]);
  expect(getValuation.mock.calls).toEqual([[pikachu.id]]);
});

it('표본 부족 상태와 null 가격을 모델에 전달한다', async () => {
  const eevee = mockCards[2]!;
  const answer = 'Eevee SV 133은 시연용 데이터의 표본이 부족해 적정가를 확인할 수 없습니다.';
  const { runtime } = setup('get_valuation',
    () => toolCall('search_cards', { query: 'Eevee' }, 'search'),
    () => toolCall('get_valuation', { cardVariantId: eevee.id }, 'price'),
    request => {
      expect(toolResult(request, 'price')).toMatchObject({
        cardVariantId: eevee.id,
        dataSource: 'MOCK',
        status: 'INSUFFICIENT_DATA',
        estimatedPrice: null,
      });
      return reply(answer);
    },
  );

  await expect(runtime.runAgentTurn('Eevee 적정가 알려줘')).resolves.toBe(answer);
});

it('빈 입력을 모델 호출 전에 거부한다', async () => {
  const { runtime, model, classify } = setup('get_valuation');
  await expect(runtime.runAgentTurn('   ')).rejects.toThrow('메시지를 입력해 주세요.');
  expect(classify).not.toHaveBeenCalled();
  expect(model.getResponse).not.toHaveBeenCalled();
});

it('검색 경로는 모델에 원문과 검색 도구만 전달한다', async () => {
  const message = 'Pikachu SV 025 영문판만 찾아줘';
  const { runtime, classify, getValuation } = setup('search_cards', request => {
    expect(request.tools.map(tool => tool.name)).toEqual(['search_cards']);
    expect(JSON.stringify(request.input)).toContain(message);
    return reply('검색 응답');
  });

  await expect(runtime.runAgentTurn(message)).resolves.toBe('검색 응답');
  expect(classify).toHaveBeenCalledExactlyOnceWith(message, undefined);
  expect(getValuation).not.toHaveBeenCalled();
});

it.each([
  ['needs_clarification', '그 카드 얼마야?', '어떤 포켓몬 카드인지'],
  ['unsupported', '피카츄 구매해줘', '포켓몬 카드 검색과 적정가 조회'],
] as const)('%s 경로는 메인 모델 없이 응답한다', async (route, message, expected) => {
  const { runtime, model, searchCards, getValuation } = setup(route);

  await expect(runtime.runAgentTurn(message)).resolves.toContain(expected);
  expect(model.getResponse).not.toHaveBeenCalled();
  expect(searchCards).not.toHaveBeenCalled();
  expect(getValuation).not.toHaveBeenCalled();
});

it('현재 턴의 검색 결과에 없는 variant ID를 가격 서비스에 넘기지 않는다', async () => {
  const pikachu = mockCards[0]!;
  const eevee = mockCards[2]!;
  const { runtime, getValuation } = setup('get_valuation',
    () => toolCall('get_valuation', { cardVariantId: pikachu.id }, 'before-search'),
    () => toolCall('search_cards', { query: 'Pikachu' }, 'search'),
    () => toolCall('get_valuation', { cardVariantId: eevee.id }, 'wrong-id'),
    () => toolCall('get_valuation', { cardVariantId: pikachu.id }, 'known-id'),
    () => reply('첫 번째 턴'),
    () => toolCall('get_valuation', { cardVariantId: pikachu.id }, 'another-turn'),
    () => reply('두 번째 턴'),
  );

  await expect(runtime.runAgentTurn('피카츄 적정가 알려줘')).resolves.toBe('첫 번째 턴');
  await expect(runtime.runAgentTurn('피카츄 적정가 다시 알려줘')).resolves.toBe('두 번째 턴');
  expect(getValuation).toHaveBeenCalledExactlyOnceWith(pikachu.id);
});

it('분류 실패 시 메인 모델과 도구를 호출하지 않는다', async () => {
  const { runtime, classify, model, searchCards, getValuation } = setup('get_valuation');
  classify.mockRejectedValueOnce(new Error('분류 호출 실패'));

  await expect(runtime.runAgentTurn('피카츄 적정가 알려줘')).rejects.toThrow('분류 호출 실패');
  expect(model.getResponse).not.toHaveBeenCalled();
  expect(searchCards).not.toHaveBeenCalled();
  expect(getValuation).not.toHaveBeenCalled();
});
