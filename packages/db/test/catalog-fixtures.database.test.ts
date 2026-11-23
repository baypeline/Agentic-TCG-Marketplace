import { randomInt, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient, readCatalogFixtures, seedCollectedCatalog, type CatalogFixtures } from '../src/index.js';

const integration = it.skipIf(!process.env.DATABASE_TEST_URL);
async function setup() {
  const base = await readCatalogFixtures(); const id = randomUUID(); const token = `fixture-${id}`; const speciesId = randomInt(1_000_000, 1_000_000_000);
  const name = `Fixture ${id}`; const koreanName = `시험${id}`;
  const sourceUrl = 'https://example.test/names';
  const template = base.cards.find(card => card.language === 'EN')!;
  const identity = base.externalIdentities.find(row => row.id === template.externalIdentityId)!;
  const data: CatalogFixtures = {
    cards: [{ ...template, id, externalIdentityId: id, name, setCode: token }],
    externalIdentities: [{ ...identity, id, externalId: token }],
    koreanNames: {
      translations: [{ ...base.koreanNames.translations[0]!, speciesId, englishName: name, englishKey: name.toLowerCase(), koreanName, sourceUrl }],
      localizedNames: [{ cardVariantId: id, speciesId, locale: 'ko', name: koreanName, source: 'POKEAPI_SPECIES', sourceUrl }],
    },
    priceSnapshots: [{ ...base.priceSnapshots[0]!, id: randomUUID(), cardVariantId: id, externalId: token }],
  };
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
  expect(await prisma.pokemonNameTranslation.findUnique({ where: { speciesId } })).toBeNull();
  return { prisma, data, id, speciesId };
}
async function fixture(run: (context: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const c = await setup();
  try { await run(c); }
  finally {
    await c.prisma.marketPriceSnapshot.deleteMany({ where: { cardVariantId: c.id } });
    await c.prisma.cardVariant.deleteMany({ where: { id: c.id } });
    await c.prisma.externalCardIdentity.deleteMany({ where: { id: c.id } });
    await c.prisma.pokemonNameTranslation.deleteMany({ where: { speciesId: c.speciesId, sourceUrl: 'https://example.test/names' } });
    await c.prisma.$disconnect();
  }
}
integration('빈 영역에 JSON만으로 FK 순서대로 넣고 반복·동시 seed도 중복하지 않는다', async () => fixture(async c => {
  const results = await Promise.all([seedCollectedCatalog(c.prisma, c.data), seedCollectedCatalog(c.prisma, c.data)]);
  expect(results.reduce((sum, row) => sum + row.insertedCards, 0)).toBe(1);
  expect(await seedCollectedCatalog(c.prisma, c.data)).toEqual({ insertedIdentities: 0, insertedCards: 0, insertedTranslations: 0, insertedLocalizedNames: 0, insertedPrices: 0 });
  const card = await c.prisma.cardVariant.findUniqueOrThrow({ where: { id: c.id }, include: { localizedNames: true, marketPrices: true } });
  expect(card.localizedNames[0]!.name).toBe(c.data.koreanNames.localizedNames[0]!.name);
  expect(card.marketPrices[0]!.observedAt.toISOString()).toBe(c.data.priceSnapshots[0]!.observedAt);
  expect(card.marketPrices[0]!.collectedAt.toISOString()).toBe(c.data.priceSnapshots[0]!.collectedAt);
  expect(await c.prisma.marketPriceAssessment.count({ where: { snapshotId: c.data.priceSnapshots[0]!.id } })).toBe(0);
}));
integration('KO 원문과 이미지 부재를 번역 사전이나 영어판 가격 없이 복원한다', async () => fixture(async c => {
  const data = structuredClone(c.data);
  data.cards[0] = { ...data.cards[0]!, name: `한국어카드${c.id}`, language: 'KO', imageUrl: null };
  data.externalIdentities[0]!.language = 'KO'; data.koreanNames.localizedNames = []; data.priceSnapshots = [];
  await seedCollectedCatalog(c.prisma, data);
  expect(await seedCollectedCatalog(c.prisma, data)).toMatchObject({ insertedCards: 0, insertedIdentities: 0 });
  expect(await c.prisma.cardVariant.findUnique({ where: { id: c.id } })).toMatchObject({ language: 'KO', name: `한국어카드${c.id}`, imageUrl: null });
  expect(await c.prisma.cardLocalizedName.count({ where: { cardVariantId: c.id } })).toBe(0);
  expect(await c.prisma.marketPriceSnapshot.count({ where: { cardVariantId: c.id } })).toBe(0);
}));
integration('기존 최신 카드 메타데이터와 수집 시각은 예전 JSON으로 되돌리지 않는다', async () => fixture(async c => {
  await seedCollectedCatalog(c.prisma, c.data);
  const lastCollectedAt = new Date('2026-11-23T00:00:00Z');
  await c.prisma.cardVariant.update({ where: { id: c.id }, data: { imageUrl: 'https://example.test/new-image.webp', lastCollectedAt } });
  await seedCollectedCatalog(c.prisma, c.data);
  expect(await c.prisma.cardVariant.findUnique({ where: { id: c.id } })).toMatchObject({ imageUrl: 'https://example.test/new-image.webp', lastCollectedAt });
}));
integration('고정 가격 UUID의 내용 충돌은 새 데이터 삽입까지 롤백한다', async () => fixture(async c => {
  await seedCollectedCatalog(c.prisma, c.data);
  const changed = structuredClone(c.data);
  changed.priceSnapshots[0]!.originalAmount = '999';
  changed.koreanNames.localizedNames = [];
  await c.prisma.cardLocalizedName.deleteMany({ where: { cardVariantId: c.id } });
  // 트랜잭션에서 먼저 추가될 이름도 가격 충돌이 발견되면 롤백되어야 한다.
  changed.koreanNames.localizedNames = c.data.koreanNames.localizedNames;
  await expect(seedCollectedCatalog(c.prisma, changed)).rejects.toThrow('Fixture price conflicts');
  expect(await c.prisma.cardLocalizedName.count({ where: { cardVariantId: c.id } })).toBe(0);
  expect((await c.prisma.marketPriceSnapshot.findUniqueOrThrow({ where: { id: c.data.priceSnapshots[0]!.id } })).originalAmount).toBe(c.data.priceSnapshots[0]!.originalAmount);
}));
integration('다른 UUID에 예약된 외부 ID는 재매핑하지 않으며 전체 배치를 취소한다', async () => fixture(async c => {
  const otherId = randomUUID();
  await c.prisma.externalCardIdentity.create({ data: { ...c.data.externalIdentities[0]!, id: otherId } });
  try {
    await expect(seedCollectedCatalog(c.prisma, c.data)).rejects.toThrow('Fixture external identity conflicts');
    expect(await c.prisma.cardVariant.findUnique({ where: { id: c.id } })).toBeNull();
    expect(await c.prisma.externalCardIdentity.findUnique({ where: { id: otherId } })).not.toBeNull();
  } finally { await c.prisma.externalCardIdentity.delete({ where: { id: otherId } }); }
}));
