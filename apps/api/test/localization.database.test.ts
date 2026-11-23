import { randomInt, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { parseApiEnv } from '@tcg/config';
import { createPokemonLocalizationService } from '@tcg/aggregator';
import { cardSearchResponseSchema, cardVariantSchema } from '@tcg/contracts';
import { buildApp } from '../src/app.js';

it.skipIf(!process.env.DATABASE_TEST_URL)('한국어와 영어 검색이 같은 카드 UUID를 반환하고 인쇄 언어는 보존된다', async () => {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
  const token = randomUUID(); const id = randomUUID(); const speciesId = randomInt(1_000_000, 1_000_000_000);
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  const name = `Korean API ${token}`; const koreanName = `검색테스트${token}`;
  try {
    expect(await prisma.pokemonNameTranslation.findUnique({ where: { speciesId } })).toBeNull();
    await prisma.cardVariant.create({ data: { id, game: 'POKEMON', name, setCode: token, cardNumber: '1', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' } });
    await createPokemonLocalizationService({ prisma, provider: { async loadNames() { return [{ speciesId, englishName: name, koreanName, sourceUrl: `https://example.test/ko-test/${token}` }]; } } }).importNames();
    app = await buildApp({ env: parseApiEnv({ NODE_ENV: 'test', DATABASE_ENABLED: 'true', DATABASE_URL: process.env.DATABASE_TEST_URL, CARD_DATA_SOURCE: 'database' }) });
    for (const query of [koreanName, name]) {
      const response = await app.inject(`/api/cards?${new URLSearchParams({ q: query, limit: '1' })}`);
      expect(response.statusCode).toBe(200);
      const cards = cardSearchResponseSchema.parse(response.json()).items;
      expect(cards).toHaveLength(1);
      expect(cards[0]).toMatchObject({ id, name, language: 'EN', localizedNames: [{ locale: 'ko', name: koreanName, source: 'POKEAPI_SPECIES' }] });
    }
    const detail = await app.inject(`/api/cards/${id}`);
    expect(cardVariantSchema.parse(detail.json())).toMatchObject({ id, name, language: 'EN', localizedNames: [{ name: koreanName }] });
  } finally {
    await app?.close();
    await prisma.cardVariant.deleteMany({ where: { id } });
    await prisma.pokemonNameTranslation.deleteMany({ where: { speciesId, sourceUrl: `https://example.test/ko-test/${token}` } });
    await prisma.$disconnect();
  }
});
