import Fastify, { type FastifyInstance } from 'fastify';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { connectMcpCardServices } from '@tcg/agent';
import { createAggregatorService, createMockCardAdapter } from '@tcg/aggregator';
import { createMockPriceAdapter, createValuationService } from '@tcg/valuation';
import { createMcpPlugin, type McpPluginDependencies } from '../src/index.js';

const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
const valuationService = createValuationService({ aggregatorService, adapter: createMockPriceAdapter() });
const apps: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function createHost(options: Pick<McpPluginDependencies, 'allowedOrigins'> = {}) {
  const app = Fastify();
  apps.push(app);
  await app.register(createMcpPlugin({ aggregatorService, valuationService, ...options }));
  await app.ready();
  return app;
}

async function listen(app: FastifyInstance) {
  await app.listen({ host: '127.0.0.1', port: 0 });
  return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}/mcp`;
}

// 2025 방식 응답은 SSE 한 건으로 오고, JSON으로 오면 그대로 읽는다.
function readJsonRpc(body: string) {
  const data = body.split('\n').find(line => line.startsWith('data: '));
  return JSON.parse(data === undefined ? body : data.slice('data: '.length));
}

const mcpHeaders = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'plugin-test', version: '1.0.0' } },
};
const post = (app: FastifyInstance, payload: unknown, headers: Record<string, string> = mcpHeaders) =>
  app.inject({ method: 'POST', url: '/mcp', headers, payload: typeof payload === 'string' ? payload : JSON.stringify(payload) });

describe('MCP Fastify 플러그인', () => {
  it('initialize에 도구 기능을 알리고 세션 ID를 발급하지 않는다', async () => {
    const app = await createHost();
    const response = await post(app, initialize);
    expect(response.statusCode).toBe(200);
    expect(response.headers['mcp-session-id']).toBeUndefined();
    const { result } = readJsonRpc(response.body);
    expect(result.serverInfo.name).toBe('tcg-marketplace');
    expect(result.capabilities.tools).toBeDefined();
    const initialized = await post(app, { jsonrpc: '2.0', method: 'notifications/initialized' });
    expect(initialized.statusCode).toBe(202);
    expect(initialized.body).toBe('');
  });

  it('GET과 DELETE는 405로 거절한다', async () => {
    const app = await createHost();
    for (const method of ['GET', 'DELETE'] as const) {
      const response = await app.inject({ method, url: '/mcp', headers: { accept: 'application/json, text/event-stream' } });
      expect(response.statusCode).toBe(405);
    }
  });

  it('깨진 JSON과 지원하지 않는 형식은 SDK 규칙대로 거절한다', async () => {
    const app = await createHost();
    const broken = await post(app, '{"jsonrpc":');
    expect(broken.statusCode).toBe(400);
    expect(readJsonRpc(broken.body).error.code).toBe(-32700);
    const plain = await post(app, JSON.stringify(initialize), { ...mcpHeaders, 'content-type': 'text/plain' });
    expect(plain.statusCode).toBe(415);
  });

  it('Origin은 기본으로 거절하고 허용 목록의 호스트 이름만 통과시킨다', async () => {
    const closed = await createHost();
    expect((await post(closed, initialize, { ...mcpHeaders, origin: 'http://localhost:3000' })).statusCode).toBe(403);
    const open = await createHost({ allowedOrigins: ['localhost'] });
    expect((await post(open, initialize, { ...mcpHeaders, origin: 'https://evil.example' })).statusCode).toBe(403);
    expect((await post(open, initialize, { ...mcpHeaders, origin: 'http://localhost:3000' })).statusCode).toBe(200);
  });

  it('실제 HTTP에서 SDK 클라이언트로 도구를 호출한다', async () => {
    const url = await listen(await createHost());
    const client = new Client({ name: 'http-test', version: '1.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    try {
      const result = await client.callTool({ name: 'search_cards', arguments: { query: 'pika', limit: 1 } });
      expect(result.structuredContent).toMatchObject({ ok: true, data: { items: [{ name: 'Pikachu' }], nextCursor: null } });
    } finally {
      await client.close();
    }
  });

  it('재민 님 Agent 클라이언트가 검색 결과 ID로 적정가까지 조회한다', async () => {
    const url = await listen(await createHost());
    const mcp = await connectMcpCardServices({ url });
    try {
      const [card] = await mcp.aggregatorService.searchCards({ query: 'Pikachu', limit: 10 });
      expect(card?.name).toBe('Pikachu');
      const valuation = await mcp.valuationService.getValuation(card!.id);
      expect(valuation).toMatchObject({ cardVariantId: card!.id, status: 'AVAILABLE', estimatedPrice: '12000000' });
    } finally {
      await mcp.close();
    }
  });
});
