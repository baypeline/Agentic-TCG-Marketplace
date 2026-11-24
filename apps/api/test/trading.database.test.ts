import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { parseApiEnv } from '@tcg/config';
import { demoCards } from '@tcg/contracts/fixtures';
import { createPrismaClient, seedDemoCatalog } from '@tcg/db';
import { demoSellerId } from '@tcg/trading';
import { buildApp } from '../src/app.js';
import { createIntegrationPlugins } from '../src/integrations.js';
import { createDemoAuthResolver } from '../src/demo-auth.js';
import { testExecutionContext } from './trading-fixtures.js';

const databaseUrl = process.env.DATABASE_TEST_URL;

it.skipIf(!databaseUrl)('DB 거래를 재시작 후에도 보존하고 백그라운드에서 만료 예약을 해제한다', async () => {
  const env = parseApiEnv({
    NODE_ENV: 'test', DATABASE_ENABLED: 'true', DATABASE_URL: databaseUrl,
    CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', TRADING_SWEEP_INTERVAL_MS: 100,
    DEMO_SELLER_TOKEN: 'seller-db-test-'.repeat(3), DEMO_BUYER_TOKEN: 'buyer-db-test-'.repeat(3),
  });
  const sellerHeaders = { authorization: `Bearer ${env.DEMO_SELLER_TOKEN}` };
  const buyerHeaders = { authorization: `Bearer ${env.DEMO_BUYER_TOKEN}` };
  const prisma = createPrismaClient(databaseUrl!);
  const inventoryItemId = randomUUID();
  const listingKey = randomUUID();
  const quoteKey = randomUUID();
  const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
  const createHost = async () => {
    const app = await buildApp({ env, createIntegrationPlugins, tradingExecutionContext: testExecutionContext, resolveAuth: createDemoAuthResolver(env) });
    apps.push(app);
    return app;
  };
  try {
    await seedDemoCatalog(prisma);
    await prisma.inventoryItem.create({ data: { id: inventoryItemId, cardVariantId: demoCards[0]!.id, ownerId: demoSellerId } });
    const app = await createHost();
    expect((await app.inject('/health')).json()).toMatchObject({ tradingDataSource: 'database' });
    const listed = await app.inject({ method: 'POST', url: '/api/listings', headers: { ...sellerHeaders, 'idempotency-key': listingKey }, payload: { inventoryItemId, price: '10000000' } });
    expect(listed.statusCode).toBe(201);
    const listing = listed.json();
    const reserved = await app.inject({ method: 'POST', url: '/api/purchases/fixed/quote', headers: { ...buyerHeaders, 'idempotency-key': quoteKey }, payload: { listingId: listing.id, maxPrice: '10000000' } });
    expect(reserved.statusCode).toBe(200);
    const quote = reserved.json();
    const forbidden = await app.inject({ method: 'DELETE', url: `/api/quotes/${quote.id}`, headers: { ...sellerHeaders, 'idempotency-key': randomUUID() } });
    expect(forbidden.statusCode).toBe(403);
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const restarted = await createHost();
    expect((await restarted.inject({ url: '/api/inventory', headers: { ...sellerHeaders, 'idempotency-key': randomUUID() } })).json()).toContainEqual({
      id: inventoryItemId, cardVariantId: demoCards[0]!.id, ownerId: demoSellerId, status: 'RESERVED',
    });
    await prisma.matchQuote.update({ where: { id: quote.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    // 조회 API를 호출하지 않아도 호스트의 주기 작업이 DB 상태를 바꿔야 한다.
    await expect.poll(async () => (await prisma.matchQuote.findUnique({ where: { id: quote.id } }))?.status, { timeout: 5000 }).toBe('RELEASED');
    expect(await prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } })).toMatchObject({ status: 'LISTED' });
    expect((await restarted.inject(`/api/listings?cardVariantId=${listing.cardVariantId}`)).json()).toContainEqual(listing);
  } finally {
    await Promise.all(apps.map(app => app.close()));
    try {
      await prisma.$transaction([
        prisma.tradingRequest.deleteMany({ where: { requestKey: { in: [listingKey, quoteKey] } } }),
        prisma.matchQuote.deleteMany({ where: { inventoryItemId } }),
        prisma.listing.deleteMany({ where: { inventoryItemId } }),
        prisma.inventoryItem.deleteMany({ where: { id: inventoryItemId } }),
      ]);
    } finally { await prisma.$disconnect(); }
  }
});
