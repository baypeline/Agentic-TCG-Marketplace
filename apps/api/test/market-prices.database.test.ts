import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { parseApiEnv } from '@tcg/config';
import { marketPricesResponseSchema, valuationSchema } from '@tcg/contracts';
import { createMarketPriceServices } from '@tcg/valuation';
import { buildApp } from '../src/app.js';

it.skipIf(!process.env.DATABASE_TEST_URL)('실제 가격 REST는 미검증 표본을 제외하고 승인 후 환산 결과와 근거 시각을 반환한다', async () => {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!); const id = randomUUID(); const externalId = `api-${id}`;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const observedAt = new Date(Date.now() - 3_600_000).toISOString();
  try {
    await prisma.externalCardIdentity.create({ data: { id, provider: 'TCGDEX', externalId, language: 'EN', edition: 'NORMAL', condition: 'NM' } });
    await prisma.cardVariant.create({ data: { id, name: 'Price REST test', game: 'POKEMON', setCode: externalId, cardNumber: '1', language: 'EN', edition: 'NORMAL', condition: 'NM', externalIdentityId: id } });
    const service = createMarketPriceServices({ prisma, provider: { async getPrices() { return [{ provider: 'TCGPLAYER', externalId, providerVariant: 'normal', priceType: 'PROVIDER_MARKET', originalCurrency: 'USD', originalAmount: '12.5', sourceUrl: 'https://example.test/market', observedAt }]; } } });
    await service.collectPrices(id);
    app = await buildApp({ env: parseApiEnv({ NODE_ENV: 'test', DATABASE_ENABLED: 'true', DATABASE_URL: process.env.DATABASE_TEST_URL, CARD_DATA_SOURCE: 'database', PRICE_DATA_SOURCE: 'market' }) });
    const response = await app.inject(`/api/cards/${id}/prices`);
    expect(response.statusCode).toBe(200);
    const prices = marketPricesResponseSchema.parse(response.json());
    expect(prices.items[0]).toMatchObject({ originalCurrency: 'USD', originalAmount: '12.5', eligibility: 'UNVERIFIED_VARIANT' });
    expect(valuationSchema.parse((await app.inject(`/api/cards/${id}/valuation`)).json())).toMatchObject({ status: 'INSUFFICIENT_DATA', dataSource: 'MARKET', sampleSize: 0 });
    await service.assessPrice({ snapshotId: prices.items[0]!.id, language: 'EN', edition: 'NORMAL', condition: 'NM', matchEvidenceUrl: 'https://example.test/matching', fxRate: '0.998', fxSourceUrl: 'https://example.test/fx', fxObservedAt: observedAt });
    expect(valuationSchema.parse((await app.inject(`/api/cards/${id}/valuation`)).json())).toMatchObject({ status: 'AVAILABLE', dataSource: 'MARKET', estimatedPrice: '12475000', sampleSize: 1, latestObservedAt: observedAt });
    expect((await app.inject('/api/cards/not-a-uuid/prices')).statusCode).toBe(400);
    expect((await app.inject(`/api/cards/${randomUUID()}/prices`)).statusCode).toBe(404);
  } finally {
    await app?.close();
    await prisma.marketPriceSnapshot.deleteMany({ where: { cardVariantId: id } });
    await prisma.cardVariant.deleteMany({ where: { id } });
    await prisma.externalCardIdentity.deleteMany({ where: { id } });
    await prisma.$disconnect();
  }
});
