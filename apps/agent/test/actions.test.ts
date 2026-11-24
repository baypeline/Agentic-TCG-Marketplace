import { expect, it, vi, afterEach } from 'vitest';
import { createServerMcpClient } from '../src/index.js';
afterEach(() => vi.unstubAllGlobals());
it('서버가 보관한 키를 재시도에 유지하고 서명은 도구 인수 대신 전송 메타데이터에 넣는다', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('connection lost')).mockResolvedValueOnce(new Response(JSON.stringify({ result: { structuredContent: { ok: true, data: {} } } })));
  vi.stubGlobal('fetch', fetch);
  const keyFor = vi.fn(async () => 'persisted-action-key');
  const client = createServerMcpClient({ url: 'http://127.0.0.1/mcp', keyFor });
  await client.call('execute_purchase', { matchQuoteId: 'quote' }, 'execute', { signature: 'test-only-signature' });
  expect(keyFor).toHaveBeenCalledExactlyOnceWith('execute', { name: 'execute_purchase', args: { matchQuoteId: 'quote' } });
  expect(fetch).toHaveBeenCalledTimes(2);
  const first = fetch.mock.calls[0]![1], second = fetch.mock.calls[1]![1];
  expect(first.headers['idempotency-key']).toBe('persisted-action-key');
  expect(second.body).toBe(first.body);
  const params = JSON.parse(first.body).params;
  expect(params.arguments).toEqual({ matchQuoteId: 'quote' });
  expect(params._meta['x402/payment']).toEqual({ signature: 'test-only-signature' });
});
