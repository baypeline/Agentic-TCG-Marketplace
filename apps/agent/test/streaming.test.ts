import { type Model } from '@openai/agents';
import { expect, it, vi } from 'vitest';
import { createAggregatorService, createMockCardAdapter } from '@tcg/aggregator';
import { createMockPriceAdapter, createValuationService } from '@tcg/valuation';
import { createAgentRuntime } from '../src/index.js';

it('모델의 실제 텍스트 델타를 완료 전에 전달하고 최종 문자열 반환은 유지한다', async () => {
  let release!: () => void;
  let received!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const first = new Promise<void>(resolve => { received = resolve; });
  const model: Model = {
    getResponse: vi.fn(async () => { throw new Error('비스트리밍 호출은 사용하지 않습니다.'); }),
    async *getStreamedResponse() {
      yield { type: 'output_text_delta', delta: '피카' };
      await gate;
      yield { type: 'output_text_delta', delta: '츄' };
      yield { type: 'response_done', response: { id: 'test-stream', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }, output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '피카츄' }] }] } };
    },
  };
  const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
  const runtime = createAgentRuntime({ model, aggregatorService,
    valuationService: createValuationService({ aggregatorService, adapter: createMockPriceAdapter() }),
    decisionApi: { classify: async () => ({ route: 'search_cards', language: 'ko' }) },
  });
  const chunks: string[] = [];
  const task = runtime.runAgentTurn('피카츄 찾아줘', { onTextDelta: delta => { chunks.push(delta); received(); } });
  try { await first; expect(chunks).toEqual(['피카']); }
  finally { release(); }
  await expect(task).resolves.toBe('피카츄');
  expect(chunks).toEqual(['피카', '츄']);
  expect(model.getResponse).not.toHaveBeenCalled();
});
