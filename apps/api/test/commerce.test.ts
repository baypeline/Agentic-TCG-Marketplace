import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { parseApiEnv } from '@tcg/config';
import { demoInventory } from '@tcg/trading';
import { buildApp } from '../src/app.js';
import { createDemoAuthResolver } from '../src/demo-auth.js';
import { createIntegrationPlugins } from '../src/integrations.js';

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });
const wallet = '0x2222222222222222222222222222222222222222', recipient = '0x1111111111111111111111111111111111111111';
async function setup(executeAgentRun?: import('../src/app.js').AppOptions['executeAgentRun']) {
  const env = parseApiEnv({ NODE_ENV: 'test', DEMO_SELLER_TOKEN: 's'.repeat(32), DEMO_BUYER_TOKEN: 'b'.repeat(32) });
  const adapter = { verify: vi.fn(async () => ({ valid: true })), settle: vi.fn(async () => ({ status: 'SETTLED' as const, transactionHash: '0x'+'1'.repeat(64) })), reconcile: vi.fn(async () => ({ status: 'UNKNOWN' as const })) };
  const app = await buildApp({ env, resolveAuth: createDemoAuthResolver(env), createIntegrationPlugins, paymentOptions: { adapter, recipient, getWalletAddress: async () => wallet }, executeAgentRun });
  apps.push(app);
  const seller = { authorization: `Bearer ${env.DEMO_SELLER_TOKEN}` }, buyer = { authorization: `Bearer ${env.DEMO_BUYER_TOKEN}` };
  const fields = { enabled: true, totalBudget: '30000000', maxPerTrade: '10000000', validUntil: '2099-01-01T00:00:00.000Z' };
  const policy = await app.inject({ method: 'POST', url: '/api/policies', headers: { ...buyer, 'idempotency-key': randomUUID() }, payload: fields });
  expect(policy.statusCode).toBe(201);
  const run = await app.inject({ method: 'POST', url: '/sessions', headers: { ...buyer, 'idempotency-key': randomUUID() }, payload: { policyId: policy.json().id, instruction: '피카츄 조건 확인' } });
  expect(run.statusCode).toBe(201);
  return { app, adapter, seller, buyer, fields, policy: policy.json(), run: run.json() };
}
function rpc(body: string) { const line = body.split('\n').find(line => line.startsWith('data: ')); return JSON.parse(line ? line.slice(6) : body); }

it('정식 정책·실행 API와 x402 MCP 전송으로 결제·거래 완료를 분리해 반환한다', async () => {
  const f = await setup();
  const listing = await f.app.inject({ method: 'POST', url: '/api/listings', headers: { ...f.seller, 'idempotency-key': randomUUID() }, payload: { inventoryItemId: demoInventory[0]!.id, price: '7000000' } });
  const quote = await f.app.inject({ method: 'POST', url: '/api/purchases/fixed/quote', headers: { ...f.buyer, 'idempotency-key': randomUUID() }, payload: { listingId: listing.json().id, maxPrice: '7000000' } });
  expect(quote.statusCode).toBe(200);
  const call = (payment?: unknown) => f.app.inject({ method: 'POST', url: '/mcp', headers: { ...f.buyer, accept: 'application/json, text/event-stream', 'idempotency-key': 'execute-one' }, payload: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'execute_purchase', arguments: { matchQuoteId: quote.json().id }, ...(payment ? { _meta: { 'x402/payment': payment } } : {}) } } });
  const challenge = rpc((await call()).body).result;
  expect(challenge.isError).toBe(true); expect(challenge.structuredContent.x402Version).toBe(2);
  expect(JSON.parse(challenge.content[0].text)).toEqual(challenge.structuredContent);
  const required = challenge.structuredContent.accepts[0];
  const payment = { x402Version: 2, accepted: required, payload: { authorization: { from: wallet, to: recipient, value: required.amount, nonce: '0x'+'a'.repeat(64), validAfter: '0', validBefore: '9999999999' }, signature: '0x'+'b'.repeat(130) } };
  const settled = rpc((await call(payment)).body).result;
  expect(settled.structuredContent.data).toMatchObject({ id: quote.json().id, paymentStatus: 'SETTLED', tradeStatus: 'COMPLETED' });
  expect(settled._meta['x402/payment-response'].success).toBe(true);
  await call(payment); expect(f.adapter.settle).toHaveBeenCalledTimes(1);
  const proceeds = await f.app.inject({ url: '/api/seller-proceeds', headers: f.seller });
  expect(proceeds.json()).toMatchObject({ amount: '7000000', tradeCount: 1, withdrawable: false });
});

it('정책 변경·실행 중단은 기존 예약을 취소하지 않고 결제 보류 사유를 제공한다', async () => {
  const f = await setup();
  const listing = await f.app.inject({ method: 'POST', url: '/api/listings', headers: { ...f.seller, 'idempotency-key': randomUUID() }, payload: { inventoryItemId: demoInventory[0]!.id, price: '7000000' } });
  const quote = await f.app.inject({ method: 'POST', url: '/api/purchases/fixed/quote', headers: { ...f.buyer, 'idempotency-key': randomUUID() }, payload: { listingId: listing.json().id, maxPrice: '7000000' } });
  expect((await f.app.inject({ method: 'PUT', url: `/api/policies/${f.policy.id}`, headers: { ...f.buyer, 'idempotency-key': randomUUID() }, payload: { ...f.fields, maxPerTrade: '5000000', expectedVersion: 1 } })).statusCode).toBe(200);
  await f.app.inject({ method: 'POST', url: `/sessions/${f.run.id}/stop`, headers: f.buyer });
  const result = (await f.app.inject({ url: `/api/purchases/${quote.json().id}/status`, headers: f.buyer })).json();
  expect(result).toMatchObject({ quoteStatus: 'RESERVED', expiresAt: quote.json().expiresAt, retryPaymentAllowed: false });
  expect(result.holdReasons.length).toBeGreaterThan(0);
});

it('SSE 관찰 연결을 닫아도 서버 실행은 계속하고 재접속하면 같은 실행 결과를 받는다', async () => {
  let resolve!: (value: { result: string; completed: boolean }) => void;
  const pending = new Promise<{ result: string; completed: boolean }>(done => { resolve = done; });
  let signal: AbortSignal | undefined;
  const f = await setup(async (_run, _auth, active) => { signal = active; return pending; });
  const base = await f.app.listen({ host: '127.0.0.1', port: 0 });
  const response = await fetch(`${base}/sessions/${f.run.id}/events`, { headers: f.buyer });
  const reader = response.body!.getReader(); await reader.read(); await reader.cancel();
  expect(signal?.aborted).toBe(false);
  resolve({ result: '서버에서 완료', completed: true });
  await expect.poll(async () => (await f.app.inject({ url: `/sessions/${f.run.id}`, headers: f.buyer })).json().status).toBe('COMPLETED');
  expect((await f.app.inject({ url: `/sessions/${f.run.id}`, headers: f.buyer })).json()).toMatchObject({ id: f.run.id, result: '서버에서 완료' });
});

it('정책 비활성화는 관찰 연결과 무관하게 진행 중인 서버 작업에 중단을 전달한다', async () => {
  let signal: AbortSignal | undefined;
  const f = await setup(async (_run, _auth, active) => {
    signal = active;
    await new Promise<void>(resolve => active.addEventListener('abort', () => resolve(), { once: true }));
    return { result: '중단', completed: false };
  });
  await f.app.inject({ method: 'PUT', url: `/api/policies/${f.policy.id}`, headers: { ...f.buyer, 'idempotency-key': randomUUID() }, payload: { ...f.fields, enabled: false, expectedVersion: 1 } });
  await expect.poll(() => signal?.aborted, { timeout: 3000 }).toBe(true);
  expect((await f.app.inject({ url: `/sessions/${f.run.id}`, headers: f.buyer })).json().status).toBe('STOPPED');
});
