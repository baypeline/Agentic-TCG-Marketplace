import { afterEach, expect, it, vi } from 'vitest';
import { listingSchema, buyOrderSchema, matchQuoteSchema, errorResponseSchema } from '@tcg/contracts';
import { parseApiEnv } from '@tcg/config';
import { demoInventory, demoSellerId } from '@tcg/trading';
import { buildApp } from '../src/app.js';
import { createIntegrationPlugins } from '../src/integrations.js';
import { createDemoAuthResolver, demoBuyerAgentId } from '../src/demo-auth.js';

const tokens = { DEMO_SELLER_TOKEN: 'seller-test-'.repeat(4), DEMO_BUYER_TOKEN: 'buyer-test-'.repeat(4) };
const sellerHeaders = { authorization: `Bearer ${tokens.DEMO_SELLER_TOKEN}` };
const buyerHeaders = { authorization: `Bearer ${tokens.DEMO_BUYER_TOKEN}` };
const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
async function setup(withAuth = true) {
  const env = parseApiEnv({ NODE_ENV: 'test', ...(withAuth ? tokens : {}) });
  const app = await buildApp({ env, createIntegrationPlugins, resolveAuth: createDemoAuthResolver(env) });
  apps.push(app);
  return app;
}
afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.close()));
  vi.useRealTimers();
});

it('운영 통합 경로로 재고·매물·지정가 주문·예약·해제를 연결한다', async () => {
  const app = await setup();
  const item = demoInventory[0]!;
  expect((await app.inject('/health')).json()).toMatchObject({ tradingDataSource: 'mock' });
  expect((await app.inject({ url: '/api/inventory', headers: sellerHeaders })).json()).toHaveLength(6);
  const created = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload: { inventoryItemId: item.id, price: '10000000' } });
  expect(created.statusCode).toBe(201);
  const listing = listingSchema.parse(created.json());
  const ordered = await app.inject({ method: 'POST', url: '/api/buy-orders', headers: buyerHeaders, payload: {
    cardVariantId: item.cardVariantId, maxPrice: '9000000', expiresAt: new Date(Date.now() + 60_000).toISOString(),
  } });
  expect(ordered.statusCode).toBe(201);
  const order = buyOrderSchema.parse(ordered.json());
  expect((await app.inject({ method: 'POST', url: `/api/buy-orders/${order.id}/match`, headers: buyerHeaders })).json()).toBeNull();
  const cheaper = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload: { inventoryItemId: demoInventory[1]!.id, price: '8000000' } });
  const matched = await app.inject({ method: 'POST', url: `/api/buy-orders/${order.id}/match`, headers: buyerHeaders });
  expect(matched.statusCode).toBe(200);
  const quote = matchQuoteSchema.parse(matched.json());
  expect(quote).toMatchObject({ listingId: cheaper.json().id, buyerAgentId: demoBuyerAgentId, amount: '8000000', status: 'RESERVED' });
  expect((await app.inject({ url: '/api/buy-orders', headers: buyerHeaders })).json()).toMatchObject([{ status: 'MATCH_PENDING' }]);
  expect((await app.inject({ method: 'DELETE', url: `/api/quotes/${quote.id}`, headers: buyerHeaders })).json()).toMatchObject({ status: 'RELEASED' });
  expect((await app.inject({ url: '/api/buy-orders', headers: buyerHeaders })).json()).toMatchObject([{ status: 'ACTIVE' }]);
  expect((await app.inject({ method: 'DELETE', url: `/api/buy-orders/${order.id}`, headers: buyerHeaders })).json()).toMatchObject({ status: 'CANCELLED' });
  expect((await app.inject({ method: 'DELETE', url: `/api/listings/${listing.id}`, headers: sellerHeaders })).json()).toMatchObject({ status: 'CANCELLED' });
});

it('인증·Agent·소유권·입력 오류를 공통 오류 계약으로 반환한다', async () => {
  const app = await setup();
  const item = demoInventory[0]!;
  for (const headers of [{ 'x-user-id': demoSellerId }, { authorization: 'Bearer invalid' }]) {
    const result = await app.inject({ url: '/api/inventory', headers });
    expect(result.statusCode).toBe(401);
    expect(errorResponseSchema.parse(result.json()).error.code).toBe('UNAUTHORIZED');
  }
  const noAgent = await app.inject({ url: '/api/buy-orders', headers: sellerHeaders });
  expect(noAgent.statusCode).toBe(403);
  const forbidden = await app.inject({ method: 'POST', url: '/api/listings', headers: buyerHeaders, payload: { inventoryItemId: item.id, price: '1' } });
  expect(forbidden.statusCode).toBe(403);
  const invalid = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload: { inventoryItemId: item.id, price: '1.5' } });
  expect(invalid.statusCode).toBe(400);
  expect(errorResponseSchema.parse(invalid.json()).error.code).toBe('VALIDATION_ERROR');
  expect((await app.inject({ method: 'POST', url: '/api/trades/finalize', headers: buyerHeaders })).statusCode).toBe(404);
});

it('기본 실행은 공개 매물만 제공하고 데모 토큰을 설정하기 전 쓰기를 거부한다', async () => {
  const app = await setup(false);
  expect((await app.inject('/api/listings')).statusCode).toBe(200);
  expect((await app.inject({ url: '/api/inventory', headers: sellerHeaders })).statusCode).toBe(401);
});

it('호스트 종료 시 예약 만료 타이머를 정리한다', async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const app = await setup();
  expect(vi.getTimerCount()).toBe(1);
  await app.close();
  apps.splice(apps.indexOf(app), 1);
  expect(vi.getTimerCount()).toBe(0);
});
