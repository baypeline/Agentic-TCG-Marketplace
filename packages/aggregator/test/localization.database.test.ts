import { randomInt, randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createPokemonLocalizationService, createPrismaCardAdapter, createPrismaCardCatalogWriter, createPrismaCardIdentityStore, type PokemonNameTranslation } from '../src/index.js';

describe.skipIf(!process.env.DATABASE_TEST_URL)('한국어 이름 DB 연결', () => {
  let prisma: PrismaClient;
  const cardIds = new Set<string>();
  const speciesIds = new Set<number>();
  const externalIds = new Set<string>();
  beforeAll(() => { prisma = createPrismaClient(process.env.DATABASE_TEST_URL!); });
  afterEach(async () => {
    if (cardIds.size) await prisma.cardVariant.deleteMany({ where: { id: { in: [...cardIds] } } });
    if (externalIds.size) await prisma.externalCardIdentity.deleteMany({ where: { provider: 'TCGDEX', externalId: { in: [...externalIds] } } });
    if (speciesIds.size) await prisma.pokemonNameTranslation.deleteMany({ where: { speciesId: { in: [...speciesIds] } } });
    cardIds.clear(); speciesIds.clear(); externalIds.clear();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  async function fixture() {
    const token = randomUUID();
    const speciesId = randomInt(1_000_000, 1_000_000_000);
    expect(await prisma.pokemonNameTranslation.findUnique({ where: { speciesId } })).toBeNull();
    speciesIds.add(speciesId);
    const translation: PokemonNameTranslation = { speciesId, englishName: `Localization ${token}`, koreanName: `한글테스트${token}`, sourceUrl: `https://example.test/ko-test/${token}` };
    const id = randomUUID(); cardIds.add(id);
    const card = { id, game: 'POKEMON' as const, name: translation.englishName, setCode: token, cardNumber: '1', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' };
    return { translation, card };
  }
  function importer(translation: PokemonNameTranslation) {
    return createPokemonLocalizationService({ prisma, provider: { async loadNames() { return [translation]; } } });
  }

  it('한칭을 채우고 재실행해도 원문명·인쇄 언어·UUID와 이름 행 수를 유지한다', async () => {
    const { translation, card } = await fixture();
    await prisma.cardVariant.create({ data: card });
    expect(await importer(translation).importNames()).toMatchObject({ inserted: 1, matchedCards: 1 });
    expect(await importer(translation).importNames()).toMatchObject({ inserted: 0, updated: 0, matchedCards: 1 });
    const reader = createPrismaCardAdapter(prisma);
    expect(await reader.getCardVariant(card.id)).toMatchObject({ id: card.id, name: card.name, language: 'EN', localizedNames: [{ locale: 'ko', name: translation.koreanName, source: 'POKEAPI_SPECIES', sourceUrl: translation.sourceUrl }] });
    expect((await reader.searchCards({ query: translation.koreanName.normalize('NFD'), limit: 1 }))[0]?.id).toBe(card.id);
    expect((await reader.searchCards({ query: translation.englishName.toUpperCase(), limit: 1 }))[0]?.id).toBe(card.id);
    expect(await prisma.cardLocalizedName.count({ where: { cardVariantId: card.id } })).toBe(1);
  });

  it('정확히 일치하지 않는 장식명이나 트레이너 이름은 추측해 번역하지 않는다', async () => {
    const { translation, card } = await fixture();
    await prisma.cardVariant.create({ data: { ...card, name: card.name + ' V' } });
    await importer(translation).importNames();
    expect(await prisma.cardLocalizedName.count({ where: { cardVariantId: card.id } })).toBe(0);
    expect((await createPrismaCardAdapter(prisma).getCardVariant(card.id))?.name).toBe(card.name + ' V');
  });
  it('KO 원문에는 영문 종명 사전을 덧씌우지 않고 한국어 제목을 그대로 검색한다', async () => {
    const { translation, card } = await fixture();
    await importer(translation).importNames();
    const externalId = `native-ko-${randomUUID()}`; externalIds.add(externalId);
    const id = await createPrismaCardIdentityStore(prisma).getOrCreateId({ provider: 'TCGDEX', externalId, language: 'KO', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' }); cardIds.add(id);
    const writer = createPrismaCardCatalogWriter(prisma);
    await writer.saveCards({ cards: [{ ...card, id, language: 'KO' }], collectedAt: '2026-11-22T00:00:00Z' });
    expect(await prisma.cardLocalizedName.count({ where: { cardVariantId: id } })).toBe(0);
    await writer.saveCards({ cards: [{ ...card, id, language: 'KO', name: `원문한국어${card.id}` }], collectedAt: '2026-11-22T01:00:00Z' });
    const reader = createPrismaCardAdapter(prisma);
    expect((await reader.searchCards({ query: `원문한국어${card.id}`, limit: 1 }))[0]).toMatchObject({ id, language: 'KO', name: `원문한국어${card.id}` });
  });

  it('새 수집 카드에는 검증된 사전을 자동 적용하고 원문이 바뀌면 오래된 표기를 제거한다', async () => {
    const { translation, card } = await fixture();
    await importer(translation).importNames();
    const externalId = `ko-collection-${randomUUID()}`;
    externalIds.add(externalId);
    const id = await createPrismaCardIdentityStore(prisma).getOrCreateId({ provider: 'TCGDEX', externalId, language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' });
    cardIds.add(id);
    const writer = createPrismaCardCatalogWriter(prisma);
    const incoming = { ...card, id, localizedNames: [{ locale: 'ko' as const, name: '잘못된 표기', source: 'POKEAPI_SPECIES' as const, sourceUrl: 'https://example.test/untrusted' }] };
    const [saved] = await writer.saveCards({ cards: [incoming], collectedAt: '2026-11-20T00:00:00.000Z' });
    expect(saved?.localizedNames?.[0]?.name).toBe(translation.koreanName);
    await writer.saveCards({ cards: [{ ...incoming, name: card.name + ' V' }], collectedAt: '2026-11-21T00:00:00.000Z' });
    const changed = await createPrismaCardAdapter(prisma).getCardVariant(id);
    expect(changed).toMatchObject({ id, language: 'EN', name: card.name + ' V' });
    expect(changed?.localizedNames).toBeUndefined();
  });

  it('잘못된 이름 스냅샷은 기존 사전과 카드 표기를 변경하지 않는다', async () => {
    const { translation, card } = await fixture();
    await prisma.cardVariant.create({ data: card });
    await importer(translation).importNames();
    const bad = createPokemonLocalizationService({ prisma, provider: { async loadNames() { return [translation, translation]; } } });
    await expect(bad.importNames()).rejects.toMatchObject({ reason: 'INVALID_DATA' });
    expect((await prisma.pokemonNameTranslation.findUniqueOrThrow({ where: { speciesId: translation.speciesId } })).koreanName).toBe(translation.koreanName);
    expect((await createPrismaCardAdapter(prisma).getCardVariant(card.id))?.localizedNames?.[0]?.name).toBe(translation.koreanName);
  });
});
