import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { idSchema } from '@tcg/contracts';
import { createPrismaClient } from '../src/index.js';
import { writeCatalogFixtures } from '../src/catalog-fixtures.js';

// 명시적으로 공유할 수집 카드만 내보낸다. 전체 DB 덤프나 사용자 데이터 수집을 하지 않는다.
const sourceUrl = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv';
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
config({ path: '../../.env', quiet: true });
let prisma: ReturnType<typeof createPrismaClient> | undefined;
try {
  const selection = z.object({ legacyCardIds: z.array(idSchema).max(100), sets: z.array(z.object({ id: z.string().regex(/^[a-zA-Z0-9._-]{1,128}$/), language: z.enum(['EN', 'KO']).default('EN'), expectedCards: z.number().int().positive().max(500) }).strict()).max(10) }).strict().parse(JSON.parse(await readFile(new URL('../fixtures/selection.json', import.meta.url), 'utf8')));
  if (!process.env.DATABASE_URL) throw new Error('Missing database URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const data = await prisma.$transaction(async tx => {
    const cards = await tx.cardVariant.findMany({ where: { edition: 'UNSPECIFIED', condition: 'UNSPECIFIED', externalIdentity: { provider: 'TCGDEX', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' }, OR: [{ id: { in: selection.legacyCardIds }, language: 'EN' }, ...selection.sets.map(set => ({ setCode: set.id, language: set.language }))] }, orderBy: { id: 'asc' }, select: { id: true, game: true, name: true, setCode: true, cardNumber: true, language: true, edition: true, condition: true, imageUrl: true, externalIdentityId: true, lastCollectedAt: true } });
    if (selection.legacyCardIds.some(id => !cards.some(card => card.id === id)) || selection.sets.some(set => cards.filter(card => card.setCode === set.id && card.language === set.language).length !== set.expectedCards)) throw new Error('Incomplete selected catalog');
    const cardIds = cards.map(card => card.id);
    const externalIdentities = await tx.externalCardIdentity.findMany({ where: { id: { in: cardIds } }, orderBy: { id: 'asc' }, select: { id: true, provider: true, externalId: true, language: true, edition: true, condition: true, createdAt: true } });
    const translations = await tx.pokemonNameTranslation.findMany({ where: { sourceUrl, speciesId: { lte: 1025 } }, orderBy: { speciesId: 'asc' }, select: { speciesId: true, englishName: true, englishKey: true, koreanName: true, sourceUrl: true, importedAt: true } });
    const localizedNames = await tx.cardLocalizedName.findMany({ where: { cardVariantId: { in: cardIds }, locale: 'ko', source: 'POKEAPI_SPECIES', sourceUrl }, orderBy: { cardVariantId: 'asc' }, select: { cardVariantId: true, locale: true, name: true, source: true, sourceUrl: true, speciesId: true } });
    const allPrices = await tx.marketPriceSnapshot.findMany({ where: { cardVariantId: { in: cardIds } }, orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], select: { id: true, cardVariantId: true, provider: true, externalId: true, providerVariant: true, priceType: true, originalCurrency: true, originalAmount: true, sourceUrl: true, observedAt: true, collectedAt: true } });
    const seen = new Set<string>();
    const priceSnapshots = allPrices.filter(price => {
      const key = JSON.stringify([price.cardVariantId, price.provider, price.providerVariant, price.priceType]);
      if (seen.has(key)) return false;
      seen.add(key); return true;
    }).sort((a, b) => compare(a.id, b.id));
    return { cards, externalIdentities, koreanNames: { translations, localizedNames }, priceSnapshots };
  }, { isolationLevel: 'RepeatableRead' });
  const json = JSON.parse(JSON.stringify(data)); // Date를 원본 시각의 UTC 문자열로 변환한다.
  await writeCatalogFixtures(json);
  console.log(JSON.stringify({ cards: data.cards.length, names: data.koreanNames.translations.length, localizedNames: data.koreanNames.localizedNames.length, prices: data.priceSnapshots.length }));
} catch {
  console.error('수집 fixture 내보내기 실패. 명시한 카드와 사전 및 DB 연결을 확인하세요.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
