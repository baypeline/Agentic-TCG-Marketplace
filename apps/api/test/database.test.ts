import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createPrismaClient, seedDemoCatalog } from '@tcg/db';
import { demoCards, demoPriceObservations } from '@tcg/contracts/fixtures';
import { cardVariantSchema, valuationSchema } from '@tcg/contracts';
import { parseApiEnv } from '@tcg/config';
import { buildApp } from '../src/app.js';

describe.skipIf(!process.env.DATABASE_TEST_URL)('PostgreSQL 카탈로그 통합', () => {
  it('seed를 반복해도 동일 ID의 카드·표본이 중복되지 않는다', async () => {
    const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
    try {
      await seedDemoCatalog(prisma);
      await seedDemoCatalog(prisma);
      expect(await prisma.cardVariant.count({ where: { id: { in: demoCards.map(card => card.id) } } })).toBe(3);
      expect(await prisma.priceObservation.count({ where: { id: { in: demoPriceObservations.map(sample => sample.id) } } })).toBe(6);
    } finally { await prisma.$disconnect(); }
  });

  it('DB 전용 카드를 REST로 검색·조회하고 MARKET 표본을 Mock 평가와 분리한다', async () => {
    const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
    const id = randomUUID();
    let app: Awaited<ReturnType<typeof buildApp>> | undefined;
    try {
      await prisma.cardVariant.create({ data: {
        id, game: 'POKEMON', name: `DB-${id}`, setCode: 'TEST', cardNumber: id, language: 'EN', edition: 'TEST', condition: 'NM',
        priceObservations: { create: [
          { amount: '2000000', dataSource: 'MOCK', source: 'DB 통합 테스트 합성 표본', observedAt: new Date('2026-11-19T00:00:00Z') },
          { amount: '999000000', dataSource: 'MARKET', source: '분리 검증용 표본', observedAt: new Date('2026-11-19T00:00:00Z') },
        ] },
      } });
      app = await buildApp({ env: parseApiEnv({ NODE_ENV: 'test', DATABASE_ENABLED: 'true', DATABASE_URL: process.env.DATABASE_TEST_URL, CATALOG_MODE: 'all', CARD_DATA_SOURCE: 'database' }) });
      expect((await app.inject('/health')).json()).toMatchObject({ database: 'connected', cardDataSource: 'database', dataMode: 'mock' });
      const search = await app.inject(`/api/cards?q=db-${id}&limit=1`);
      expect(search.statusCode).toBe(200);
      expect(search.json().items.map((card: { id: string }) => card.id)).toEqual([id]);
      expect((await app.inject('/api/cards?q=%25')).json().items).toEqual([]);
      const detail = await app.inject(`/api/cards/${id}`);
      expect(cardVariantSchema.parse(detail.json())).toMatchObject({ id, name: `DB-${id}` });
      const price = await app.inject(`/api/cards/${id}/valuation`);
      expect(price.statusCode).toBe(200);
      expect(valuationSchema.parse(price.json())).toMatchObject({ dataSource: 'MOCK', estimatedPrice: '2000000', sampleSize: 1, confidence: 'LOW' });
      await prisma.priceObservation.deleteMany({ where: { cardVariantId: id, dataSource: 'MOCK' } });
      expect((await app.inject(`/api/cards/${id}/valuation`)).json()).toMatchObject({ status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0 });
      const missing = await app.inject(`/api/cards/${randomUUID()}`);
      expect(missing.statusCode).toBe(404);
    } finally {
      await app?.close();
      await prisma.priceObservation.deleteMany({ where: { cardVariantId: id } });
      await prisma.cardVariant.deleteMany({ where: { id } });
      await prisma.$disconnect();
    }
  });
});
