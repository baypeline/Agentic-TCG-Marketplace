import { createAggregatorService, createMockCardAdapter } from '@tcg/aggregator';
import { cardSearchResponseSchema, valuationSchema } from '@tcg/contracts';
import { demoCards } from '@tcg/contracts/fixtures';
import { createMcpPlugin } from '@tcg/mcp-server';
import { createMockPriceAdapter, createValuationService } from '@tcg/valuation';
import Fastify from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createMcpClientAdapter, type AgentMcpAdapter } from '../src/index.js';

describe('팀 MCP 서버와 Streamable HTTP 연동', () => {
  const app = Fastify();
  const requests: Array<{ authorization?: string; origin?: string }> = [];
  let adapter: AgentMcpAdapter;

  beforeAll(async () => {
    const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
    const valuationService = createValuationService({
      aggregatorService,
      adapter: createMockPriceAdapter(),
      now: () => new Date('2026-11-20T00:00:00Z'),
    });
    app.addHook('onRequest', async request => {
      requests.push({ authorization: request.headers.authorization, origin: request.headers.origin });
    });
    app.register(createMcpPlugin({ aggregatorService, valuationService }));
    const url = await app.listen({ port: 0, host: '127.0.0.1' });
    adapter = createMcpClientAdapter({ url: url + '/mcp', headers: { Authorization: 'Bearer test-only' } });
    await adapter.connect();
  });

  afterAll(async () => {
    try {
      await adapter?.close();
    } finally {
      await app.close();
    }
  });

  it('목록에 등록된 카드 도구를 공개하고 검색어에 맞는 카드만 반환한다', async () => {
    expect((await adapter.listTools()).map(tool => tool.name).sort()).toEqual(['get_valuation', 'search_cards']);
    const data = await adapter.callTool('search_cards', { query: 'Pikachu', limit: 10 });
    expect(cardSearchResponseSchema.parse(data)).toEqual({ items: [demoCards[0]], nextCursor: null });
    expect(requests.length).toBeGreaterThan(0);
    for (const headers of requests) expect(headers).toEqual({ authorization: 'Bearer test-only', origin: undefined });
  });

  it('가격이 있는 카드와 표본이 없는 카드를 공통 스키마로 읽는다', async () => {
    const pikachuId = demoCards[0]!.id;
    const eeveeId = demoCards[2]!.id;
    const pikachu = valuationSchema.parse(await adapter.callTool('get_valuation', { cardVariantId: pikachuId }));
    expect(pikachu).toMatchObject({ cardVariantId: pikachuId, status: 'AVAILABLE', dataSource: 'MOCK' });
    const eevee = valuationSchema.parse(await adapter.callTool('get_valuation', { cardVariantId: eeveeId }));
    expect(eevee).toMatchObject({ cardVariantId: eeveeId, status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0 });
  });

  it('잘못된 인수와 없는 카드의 업무 코드 및 요청 ID를 보존한다', async () => {
    const common = { name: 'McpToolError', retryable: false, requestId: expect.stringMatching(/\S/) };
    await expect(adapter.callTool('search_cards', { query: 'Pikachu', limit: 0 }))
      .rejects.toMatchObject({ ...common, code: 'VALIDATION_ERROR' });
    await expect(adapter.callTool('get_valuation', { cardVariantId: '00000000-0000-4000-8000-000000000099' }))
      .rejects.toMatchObject({ ...common, code: 'CARD_NOT_FOUND' });
    await expect(adapter.callTool('unknown', {})).rejects.toMatchObject({ code: -32602 });
  });
});
