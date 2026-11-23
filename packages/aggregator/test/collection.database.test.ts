import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import type { CardVariant } from '@tcg/contracts';
import { createPrismaCardAdapter, createPrismaCardCatalogWriter, createPrismaCardIdentityStore } from '../src/index.js';

describe.skipIf(!process.env.DATABASE_TEST_URL)('카드 수집 PostgreSQL 저장', () => {
  let prisma: PrismaClient;
  const ids = new Set<string>();
  const externalIds = new Set<string>();
  const firstTime = '2026-11-20T00:00:00.000Z';
  const nextTime = '2026-11-21T00:00:00.000Z';
  beforeAll(() => { prisma = createPrismaClient(process.env.DATABASE_TEST_URL!); });
  afterEach(async () => {
    if (ids.size) await prisma.cardVariant.deleteMany({ where: { id: { in: [...ids] } } });
    if (externalIds.size) await prisma.externalCardIdentity.deleteMany({ where: { provider: 'TCGDEX', externalId: { in: [...externalIds] } } });
    ids.clear(); externalIds.clear();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function card(): Promise<Omit<CardVariant, 'localizedNames'>> {
    const token = randomUUID();
    const externalId = `collection-test-${token}`;
    externalIds.add(externalId);
    const id = await createPrismaCardIdentityStore(prisma).getOrCreateId({ provider: 'TCGDEX', externalId, language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' });
    ids.add(id);
    return { id, game: 'POKEMON', name: `Collected ${token}`, setCode: token, cardNumber: '1', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED', imageUrl: 'https://assets.tcgdex.net/en/base/base1/58/high.webp' };
  }

  it('같은 UUID로 재수집하고 갱신된 카드를 일반 DB 경로로 조회한다', async () => {
    const original = await card();
    const writer = createPrismaCardCatalogWriter(prisma);
    await writer.saveCards({ cards: [original], collectedAt: firstTime });
    const updated = { ...original, name: 'Updated ' + original.id };
    await writer.saveCards({ cards: [updated], collectedAt: nextTime });
    expect(await prisma.cardVariant.count({ where: { id: original.id } })).toBe(1);
    expect(await createPrismaCardAdapter(prisma).getCardVariant(original.id)).toEqual(updated);
    const row = await prisma.cardVariant.findUniqueOrThrow({ where: { id: original.id }, include: { externalIdentity: true } });
    expect(row.externalIdentityId).toBe(row.id);
    expect(row.externalIdentity?.provider).toBe('TCGDEX');
    expect(row.lastCollectedAt?.toISOString()).toBe(nextTime);
    expect((await createPrismaCardAdapter(prisma).searchCards({ query: 'updated ' + original.id, limit: 5 }))[0]?.id).toBe(original.id);
    expect(await prisma.priceObservation.count({ where: { cardVariantId: original.id } })).toBe(0);
  });

  it('오래된 수집이 늦게 완료되어도 최신 정보와 시각을 유지한다', async () => {
    const original = await card();
    const writer = createPrismaCardCatalogWriter(prisma);
    const latest = { ...original, name: 'Latest ' + original.id, imageUrl: undefined };
    await writer.saveCards({ cards: [latest], collectedAt: nextTime });
    expect(await writer.saveCards({ cards: [original], collectedAt: firstTime })).toEqual([latest]);
    const row = await prisma.cardVariant.findUniqueOrThrow({ where: { id: original.id } });
    expect(row.lastCollectedAt?.toISOString()).toBe(nextTime);
    expect(row.imageUrl).toBeNull();
  });

  it('독립 Client의 동시 수집에서도 카드와 매핑이 중복되지 않는다', async () => {
    const cards = [await card(), await card()];
    const other = createPrismaClient(process.env.DATABASE_TEST_URL!);
    try {
      const results = await Promise.all([
        createPrismaCardCatalogWriter(prisma).saveCards({ cards, collectedAt: firstTime }),
        createPrismaCardCatalogWriter(other).saveCards({ cards: [...cards].reverse(), collectedAt: firstTime }),
      ]);
      expect(results[0]?.map(item => item.id)).toEqual(cards.map(item => item.id));
      expect(results[1]?.map(item => item.id)).toEqual([...cards].reverse().map(item => item.id));
      expect(await prisma.cardVariant.count({ where: { id: { in: [...ids] } } })).toBe(2);
    } finally { await other.$disconnect(); }
  });

  it('다른 UUID의 변형 키와 충돌해도 기존 카드 식별자를 변경하지 않는다', async () => {
    const incoming = await card();
    const existing = { ...incoming, id: randomUUID(), name: 'Existing card' };
    ids.add(existing.id);
    await prisma.cardVariant.create({ data: existing });
    await expect(createPrismaCardCatalogWriter(prisma).saveCards({ cards: [incoming], collectedAt: firstTime })).rejects.toMatchObject({ reason: 'VARIANT_CONFLICT' });
    expect(await prisma.cardVariant.findUnique({ where: { id: incoming.id } })).toBeNull();
    expect((await prisma.cardVariant.findUniqueOrThrow({ where: { id: existing.id } })).name).toBe('Existing card');
  });

  it('중간에 매핑 불일치가 발견되면 배치 전체를 롤백한다', async () => {
    const cards = [await card(), await card()].sort((a, b) => a.id < b.id ? -1 : 1);
    cards[1] = { ...cards[1]!, language: 'JA' };
    await expect(createPrismaCardCatalogWriter(prisma).saveCards({ cards, collectedAt: firstTime })).rejects.toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    expect(await prisma.cardVariant.count({ where: { id: { in: [...ids] } } })).toBe(0);
    expect(await prisma.externalCardIdentity.count({ where: { id: { in: [...ids] } } })).toBe(2);
  });

  it('카드 식별 속성 변경과 UUID 매핑 없는 저장을 거부한다', async () => {
    const original = await card();
    const writer = createPrismaCardCatalogWriter(prisma);
    await writer.saveCards({ cards: [original], collectedAt: firstTime });
    await expect(writer.saveCards({ cards: [{ ...original, cardNumber: '2' }], collectedAt: nextTime })).rejects.toMatchObject({ reason: 'IDENTITY_MISMATCH' });
    const unknown = { ...original, id: randomUUID() };
    ids.add(unknown.id);
    await expect(writer.saveCards({ cards: [unknown], collectedAt: nextTime })).rejects.toMatchObject({ reason: 'IDENTITY_NOT_FOUND' });
    expect((await prisma.cardVariant.findUniqueOrThrow({ where: { id: original.id } })).cardNumber).toBe('1');
  });

  it('DB 제약으로 카드 UUID와 외부 매핑 UUID의 불일치를 방지한다', async () => {
    const original = await card();
    const differentId = randomUUID();
    ids.add(differentId);
    await expect(prisma.cardVariant.create({ data: { ...original, id: differentId, externalIdentityId: original.id } })).rejects.toThrow();
    expect(await prisma.cardVariant.count({ where: { id: differentId } })).toBe(0);
  });
});
