import { afterEach, expect, it } from 'vitest';
import { parseApiEnv } from '@tcg/config';
import { buildApp } from '../src/app.js';
import { createIntegrationPlugins } from '../src/integrations.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

// 2025 방식 MCP 응답은 SSE 한 건으로 온다.
function readJsonRpc(body: string) {
  const data = body.split('\n').find(line => line.startsWith('data: '));
  return JSON.parse(data === undefined ? body : data.slice('data: '.length));
}

it('운영 진입점과 같은 통합 플러그인으로 /mcp에서 도구 목록과 카드 검색을 제공한다', async () => {
  const app = await buildApp({ env: parseApiEnv({ NODE_ENV: 'test' }), createIntegrationPlugins });
  apps.push(app);
  const call = (id: number, method: string, params: object) => app.inject({
    method: 'POST',
    url: '/mcp',
    headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    payload: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
  });

  const list = await call(1, 'tools/list', {});
  expect(list.statusCode).toBe(200);
  expect(readJsonRpc(list.body).result.tools.map((tool: { name: string }) => tool.name)).toEqual(['search_cards', 'get_valuation', 'list_listings', 'get_listing', 'create_buy_order', 'list_buy_orders', 'cancel_buy_order', 'match_buy_order', 'quote_fixed_purchase', 'quote_market_purchase', 'get_purchase_status', 'execute_purchase']);

  const search = await call(2, 'tools/call', { name: 'search_cards', arguments: { query: 'pika', limit: 1 } });
  expect(readJsonRpc(search.body).result.structuredContent).toMatchObject({ ok: true, data: { items: [{ name: 'Pikachu' }] } });
});
