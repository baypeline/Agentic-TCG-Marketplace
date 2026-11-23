import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { cardVariantSchema, idSchema, timestampSchema } from '@tcg/contracts';
import type { PrismaClient } from './generated/prisma/client.js';

const uuid = idSchema.transform(value => value.toLowerCase());
const text = z.string().trim().min(1);
const https = z.url({ protocol: /^https$/ }).refine(value => { const url = new URL(value); return !url.username && !url.password; });
const decimal = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/).refine(value => Number(value) > 0);
const cardSchema = cardVariantSchema.omit({ localizedNames: true, imageUrl: true }).extend({ id: uuid, imageUrl: https.nullable(), externalIdentityId: uuid, lastCollectedAt: timestampSchema }).strict();
const identitySchema = z.object({ id: uuid, provider: z.literal('TCGDEX'), externalId: text.max(128), language: text.max(16), edition: text.max(64), condition: text.max(64), createdAt: timestampSchema }).strict();
const translationSchema = z.object({ speciesId: z.number().int().positive(), englishName: text, englishKey: text, koreanName: text.regex(/[가-힣]/), sourceUrl: https, importedAt: timestampSchema }).strict();
const localizedSchema = z.object({ cardVariantId: uuid, locale: z.literal('ko'), name: text, source: z.literal('POKEAPI_SPECIES'), sourceUrl: https, speciesId: z.number().int().positive() }).strict();
const priceSchema = z.object({
  id: uuid, cardVariantId: uuid, provider: z.enum(['CARDMARKET', 'TCGPLAYER']), externalId: text.max(128), providerVariant: text.max(64),
  priceType: z.enum(['ASKING_LOW', 'PROVIDER_MARKET', 'PROVIDER_AVERAGE', 'PROVIDER_TREND']),
  originalCurrency: z.enum(['EUR', 'USD']), originalAmount: decimal, sourceUrl: https, observedAt: timestampSchema, collectedAt: timestampSchema,
}).strict();
const bundleSchema = z.object({
  cards: z.array(cardSchema).min(1).max(500),
  externalIdentities: z.array(identitySchema).min(1).max(500),
  koreanNames: z.object({ translations: z.array(translationSchema).min(1).max(2000), localizedNames: z.array(localizedSchema).max(500) }).strict(),
  priceSnapshots: z.array(priceSchema).max(5000),
}).strict();
export type CatalogFixtures = z.infer<typeof bundleSchema>;
const normalizeName = (name: string) => name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
const key = (values: unknown[]) => JSON.stringify(values);
const identityKey = (row: { provider: string; externalId: string; language: string; edition: string; condition: string }) => key([row.provider, row.externalId, row.language, row.edition, row.condition]);
const cardKey = (row: { game: string; setCode: string; cardNumber: string; language: string; edition: string; condition: string }) => key([row.game, row.setCode, row.cardNumber, row.language, row.edition, row.condition]);
const priceKey = (row: { cardVariantId: string; provider: string; providerVariant: string; priceType: string; observedAt: string | Date }) => key([row.cardVariantId, row.provider, row.providerVariant, row.priceType, new Date(row.observedAt).getTime()]);
function unique<T>(rows: T[], getKey: (row: T) => unknown) { if (new Set(rows.map(getKey)).size !== rows.length) throw new Error('Fixture contains duplicate keys'); }

/** DB 쓰기 전에 전체 파일의 식별자·외래 키·종명 대응을 함께 검증한다. */
export function validateCatalogFixtures(input: unknown): CatalogFixtures {
  const data = bundleSchema.parse(input);
  unique(data.cards, row => row.id); unique(data.cards, cardKey);
  unique(data.externalIdentities, row => row.id); unique(data.externalIdentities, identityKey);
  unique(data.koreanNames.translations, row => row.speciesId); unique(data.koreanNames.translations, row => row.englishKey);
  unique(data.koreanNames.localizedNames, row => key([row.cardVariantId, row.locale]));
  unique(data.priceSnapshots, row => row.id); unique(data.priceSnapshots, priceKey);
  const cards = new Map(data.cards.map(row => [row.id, row]));
  const identities = new Map(data.externalIdentities.map(row => [row.id, row]));
  const names = new Map(data.koreanNames.translations.map(row => [row.speciesId, row]));
  for (const card of data.cards) {
    const identity = identities.get(card.externalIdentityId);
    if (!identity || card.id !== identity.id || (['language', 'edition', 'condition'] as const).some(field => card[field] !== identity[field])) throw new Error('Fixture card identity mismatch');
  }
  if (identities.size !== cards.size) throw new Error('Fixture contains unrelated identities');
  for (const name of names.values()) if (name.englishKey !== normalizeName(name.englishName)) throw new Error('Fixture dictionary normalization mismatch');
  for (const localized of data.koreanNames.localizedNames) {
    const card = cards.get(localized.cardVariantId); const translation = names.get(localized.speciesId);
    if (!card || card.language === 'KO' || !translation || normalizeName(card.name) !== translation.englishKey || localized.name !== translation.koreanName || localized.sourceUrl !== translation.sourceUrl) throw new Error('Fixture localized name mismatch');
  }
  for (const price of data.priceSnapshots) {
    const identity = identities.get(price.cardVariantId);
    if (!identity || price.externalId !== identity.externalId || (price.provider === 'CARDMARKET' ? 'EUR' : 'USD') !== price.originalCurrency || Date.parse(price.observedAt) > Date.parse(price.collectedAt)) throw new Error('Fixture price reference mismatch');
  }
  return data;
}

const files = { cards: 'catalog/cards.json', externalIdentities: 'catalog/external-identities.json', koreanNames: 'catalog/korean-names.json', priceSnapshots: 'market/price-snapshots.json' } as const;
const manifestSchema = z.object({ version: z.literal(1), dataKind: z.literal('COLLECTED_REFERENCE_DATA'), sha256: z.object({ cards: z.string().regex(/^[a-f0-9]{64}$/), externalIdentities: z.string().regex(/^[a-f0-9]{64}$/), koreanNames: z.string().regex(/^[a-f0-9]{64}$/), priceSnapshots: z.string().regex(/^[a-f0-9]{64}$/) }).strict() }).strict();
const digest = (content: string) => createHash('sha256').update(content).digest('hex');
export async function readCatalogFixtures(directory = new URL('../fixtures/', import.meta.url)): Promise<CatalogFixtures> {
  const manifest = manifestSchema.parse(JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8')));
  const result: Record<string, unknown> = {};
  for (const [name, path] of Object.entries(files)) {
    const content = await readFile(new URL(path, directory), 'utf8');
    if (digest(content) !== manifest.sha256[name as keyof typeof files]) throw new Error(`Fixture checksum mismatch: ${name}`);
    result[name] = JSON.parse(content);
  }
  return validateCatalogFixtures(result);
}
export async function writeCatalogFixtures(input: unknown, directory = new URL('../fixtures/', import.meta.url)) {
  const data = validateCatalogFixtures(input);
  const sha256: Record<string, string> = {};
  for (const [name, path] of Object.entries(files)) {
    const content = JSON.stringify(data[name as keyof typeof files], null, 2) + '\n';
    await mkdir(new URL('.', new URL(path, directory)), { recursive: true });
    await writeFile(new URL(path, directory), content, 'utf8');
    sha256[name] = digest(content);
  }
  // 모든 데이터 파일이 쓰인 뒤 manifest를 갱신한다. 중간 실패 파일은 seed에서 거부된다.
  await writeFile(new URL('manifest.json', directory), JSON.stringify({ version: 1, dataKind: 'COLLECTED_REFERENCE_DATA', sha256 }, null, 2) + '\n', 'utf8');
}

/** 생성 외에는 쓰지 않는다. 기존 키가 다른 데이터와 충돌하면 전체 배치를 롤백한다. */
export async function seedCollectedCatalog(prisma: PrismaClient, input: unknown) {
  const data = validateCatalogFixtures(input);
  return prisma.$transaction(async tx => {
    const identities = await tx.externalCardIdentity.createMany({ data: data.externalIdentities, skipDuplicates: true });
    for (const row of data.externalIdentities) {
      const existing = await tx.externalCardIdentity.findUnique({ where: { id: row.id } });
      if (!existing || identityKey(existing) !== identityKey(row)) throw new Error('Fixture external identity conflicts with existing data');
    }
    const cards = await tx.cardVariant.createMany({ data: data.cards, skipDuplicates: true });
    for (const row of data.cards) {
      const existing = await tx.cardVariant.findUnique({ where: { id: row.id } });
      if (!existing || cardKey(existing) !== cardKey(row) || existing.externalIdentityId !== row.externalIdentityId || existing.name !== row.name) throw new Error('Fixture card conflicts with existing data');
    }
    const translations = await tx.pokemonNameTranslation.createMany({ data: data.koreanNames.translations, skipDuplicates: true });
    const dictionary = await tx.pokemonNameTranslation.findMany({ where: { speciesId: { in: data.koreanNames.translations.map(row => row.speciesId) } } });
    const byId = new Map(dictionary.map(row => [row.speciesId, row]));
    for (const row of data.koreanNames.translations) {
      const existing = byId.get(row.speciesId);
      if (!existing || existing.englishName !== row.englishName || existing.englishKey !== row.englishKey || existing.koreanName !== row.koreanName || existing.sourceUrl !== row.sourceUrl) throw new Error('Fixture dictionary conflicts with existing data');
    }
    const localizedNames = await tx.cardLocalizedName.createMany({ data: data.koreanNames.localizedNames, skipDuplicates: true });
    for (const row of data.koreanNames.localizedNames) {
      const existing = await tx.cardLocalizedName.findUnique({ where: { cardVariantId_locale: { cardVariantId: row.cardVariantId, locale: row.locale } } });
      if (!existing || existing.name !== row.name || existing.source !== row.source || existing.sourceUrl !== row.sourceUrl || existing.speciesId !== row.speciesId) throw new Error('Fixture display name conflicts with existing data');
    }
    const prices = await tx.marketPriceSnapshot.createMany({ data: data.priceSnapshots, skipDuplicates: true });
    for (const row of data.priceSnapshots) {
      const existing = await tx.marketPriceSnapshot.findUnique({ where: { id: row.id } });
      if (!existing || priceKey(existing) !== priceKey(row) || existing.externalId !== row.externalId || existing.originalAmount !== row.originalAmount || existing.originalCurrency !== row.originalCurrency || existing.sourceUrl !== row.sourceUrl || existing.collectedAt.toISOString() !== new Date(row.collectedAt).toISOString()) throw new Error('Fixture price conflicts with existing data');
    }
    return { insertedIdentities: identities.count, insertedCards: cards.count, insertedTranslations: translations.count, insertedLocalizedNames: localizedNames.count, insertedPrices: prices.count };
  }, { timeout: 60_000 });
}
