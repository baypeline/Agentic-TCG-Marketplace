import { afterEach, describe, expect, it } from 'vitest';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { createAggregatorService, createMockCardAdapter } from '@tcg/aggregator';
import { createMockPriceAdapter, createValuationService } from '@tcg/valuation';
import type { ValuationService } from '@tcg/contracts';
import { createMcpServer } from '../src/server.js';
import { createTools, type ToolServices } from '../src/tools.js';

const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
const valuationService = createValuationService({ aggregatorService, adapter: createMockPriceAdapter() });
const PIKACHU = '00000000-0000-4000-8000-000000000001';
const EEVEE = '00000000-0000-4000-8000-000000000003';
const MISSING = '00000000-0000-4000-8000-000000000099';
const closers: Array<() => Promise<unknown>> = [];
afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())); });

async function connect(services: ToolServices = { aggregatorService, valuationService }) {
  const logged: unknown[] = [];
  const server = createMcpServer(createTools(services), {
    auth: null,
    requestId: 'req-test',
    logError: error => { logged.push(error); },
  });
  const client = new Client({ name: 'server-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  closers.push(() => client.close(), () => server.close());
  return { client, logged };
}

describe('MCP 도구', () => {
  it('도구 목록과 입력 스키마를 제공한다', async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['search_cards', 'get_valuation']);
    expect(tools[0]!.inputSchema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: { query: { type: 'string', maxLength: 200 }, limit: { type: 'integer', minimum: 1, maximum: 100 } },
    });
    expect(tools[0]!.inputSchema).not.toHaveProperty('$schema');
    expect(tools[0]!.annotations).toEqual({ readOnlyHint: true, openWorldHint: false });
    expect(tools[1]!.inputSchema).toMatchObject({ required: ['cardVariantId'] });
  });

  it('search_cards는 계약 형식으로 카드 목록을 돌려준다', async () => {
    const { client } = await connect();
    const result = await client.callTool({ name: 'search_cards', arguments: { query: 'pika', limit: 1 } });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({
      ok: true,
      requestId: 'req-test',
      data: { nextCursor: null, items: [{ id: PIKACHU, name: 'Pikachu' }] },
    });
    expect(JSON.parse((result.content as Array<{ text: string }>)[0]!.text)).toEqual(result.structuredContent);
  });

  it('잘못된 입력과 정의하지 않은 인수는 VALIDATION_ERROR로 돌려준다', async () => {
    const { client } = await connect();
    for (const args of [{ limit: 0 }, { query: 'pika', agentId: 'forged-agent' }]) {
      const result = await client.callTool({ name: 'search_cards', arguments: args });
      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        ok: false,
        requestId: 'req-test',
        error: { code: 'VALIDATION_ERROR', retryable: false },
      });
    }
    const limitError = await client.callTool({ name: 'search_cards', arguments: { limit: 0 } });
    expect((limitError.structuredContent as { error: { message: string } }).error.message).toContain('limit');
  });

  it('get_valuation은 적정가와 표본 부족 상태를 그대로 전달한다', async () => {
    const { client } = await connect();
    const available = await client.callTool({ name: 'get_valuation', arguments: { cardVariantId: PIKACHU } });
    expect(available.structuredContent).toMatchObject({
      ok: true,
      data: { cardVariantId: PIKACHU, status: 'AVAILABLE', estimatedPrice: '12000000' },
    });
    const insufficient = await client.callTool({ name: 'get_valuation', arguments: { cardVariantId: EEVEE } });
    expect(insufficient.structuredContent).toMatchObject({
      ok: true,
      data: { status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0, confidence: 'LOW' },
    });
  });

  it('AppError는 코드 그대로, 예상하지 못한 예외는 INTERNAL_ERROR로 돌려준다', async () => {
    const { client } = await connect();
    const missing = await client.callTool({ name: 'get_valuation', arguments: { cardVariantId: MISSING } });
    expect(missing.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'CARD_NOT_FOUND', message: '카드를 찾을 수 없습니다.', retryable: false },
    });

    const failing: ValuationService = { async getValuation() { throw new Error('내부 연결 정보 노출 금지'); } };
    const { client: failingClient, logged } = await connect({ aggregatorService, valuationService: failing });
    const crashed = await failingClient.callTool({ name: 'get_valuation', arguments: { cardVariantId: PIKACHU } });
    expect(crashed.structuredContent).toMatchObject({
      ok: false,
      error: { code: 'INTERNAL_ERROR', message: '서버 처리 중 오류가 발생했습니다.', retryable: false },
    });
    expect(JSON.stringify(crashed)).not.toContain('내부 연결 정보');
    expect(logged).toHaveLength(1);
  });

  it('인수를 생략하면 REST와 같은 기본값으로 검색한다', async () => {
    const calls: unknown[] = [];
    const spy = {
      ...aggregatorService,
      async searchCards(input: { query: string; limit: number }) {
        calls.push(input);
        return aggregatorService.searchCards(input);
      },
    };
    const { client } = await connect({ aggregatorService: spy, valuationService });
    const result = await client.callTool({ name: 'search_cards' });
    expect(result.isError).toBeFalsy();
    expect(calls).toEqual([{ query: '', limit: 20 }]);
  });

  it('서비스가 계약과 다른 값을 돌려주면 INTERNAL_ERROR로 숨긴다', async () => {
    const broken = { ...aggregatorService, async searchCards() { return [{ id: 'not-a-uuid' }] as never; } };
    const { client, logged } = await connect({ aggregatorService: broken, valuationService });
    const result = await client.callTool({ name: 'search_cards', arguments: { query: 'x' } });
    expect(result.structuredContent).toMatchObject({ ok: false, error: { code: 'INTERNAL_ERROR' } });
    expect(logged).toHaveLength(1);
  });

  it('없는 도구는 JSON-RPC 오류로 거절한다', async () => {
    const { client } = await connect();
    await expect(client.callTool({ name: 'execute_purchase', arguments: {} })).rejects.toThrow(/execute_purchase/);
  });
});
