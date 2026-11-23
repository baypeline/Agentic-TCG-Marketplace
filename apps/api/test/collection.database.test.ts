import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { parseApiEnv } from '@tcg/config';
import { createCardCollectionService, createPrismaCardCatalogWriter, createPrismaCardIdentityStore, createTcgdexCardAdapter } from '@tcg/aggregator';
import { cardSearchResponseSchema, cardVariantSchema, valuationSchema } from '@tcg/contracts';
import { buildApp } from '../src/app.js';

it.skipIf(!process.env.DATABASE_TEST_URL)('외부 카드 수집 후 DB 기반 REST에서 검색·상세·가격 부재를 확인한다', async () => {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
  const token = randomUUID();
  const externalId = `collection-api-${token}`;
  const name = `Collected API ${token}`;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    const fetcher = vi.fn<typeof globalThis.fetch>(async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/series/tcgp')) return Response.json({ id: 'tcgp', sets: [] });
      if (url.pathname.endsWith('/cards')) return Response.json([{ id: externalId, localId: '1', name }]);
      if (url.pathname.endsWith('/cards/' + externalId)) return Response.json({ id: externalId, localId: '1', name, set: { id: token } });
      throw new Error('Unexpected provider request');
    });
    const source = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createPrismaCardIdentityStore(prisma) });
    const collector = createCardCollectionService({ source, writer: createPrismaCardCatalogWriter(prisma) });
    const { items, storedCount } = await collector.collectCards({ query: name, limit: 1 });
    expect(storedCount).toBe(1);
    const card = items[0]!;
    expect(fetcher).toHaveBeenCalledTimes(3);
    app = await buildApp({ env: parseApiEnv({ NODE_ENV: 'test', DATABASE_ENABLED: 'true', DATABASE_URL: process.env.DATABASE_TEST_URL, CARD_DATA_SOURCE: 'database' }) });
    const search = await app.inject(`/api/cards?${new URLSearchParams({ q: name, limit: '5' })}`);
    expect(search.statusCode).toBe(200);
    expect(cardSearchResponseSchema.parse(search.json()).items).toEqual([card]);
    const detail = await app.inject(`/api/cards/${card.id}`);
    expect(detail.statusCode).toBe(200);
    expect(cardVariantSchema.parse(detail.json())).toEqual(card);
    const valuation = await app.inject(`/api/cards/${card.id}/valuation`);
    expect(valuation.statusCode).toBe(200);
    expect(valuationSchema.parse(valuation.json())).toMatchObject({ status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0 });
    expect(fetcher).toHaveBeenCalledTimes(3); // 일반 조회에서는 외부 API를 다시 호출하지 않는다
  } finally {
    await app?.close();
    const identities = await prisma.externalCardIdentity.findMany({ where: { provider: 'TCGDEX', externalId }, select: { id: true } });
    await prisma.cardVariant.deleteMany({ where: { id: { in: identities.map(identity => identity.id) } } });
    await prisma.externalCardIdentity.deleteMany({ where: { provider: 'TCGDEX', externalId } });
    await prisma.$disconnect();
  }
});
