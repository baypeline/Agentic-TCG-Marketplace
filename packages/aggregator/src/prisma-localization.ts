import type { PrismaClient } from '@tcg/db';
import { normalizePokemonNameKey, validatePokemonNames, type PokemonNameProvider } from './pokemon-names.js';

type LocalizationDb = Pick<PrismaClient, 'pokemonNameTranslation' | 'cardLocalizedName'>;

export async function syncKoreanCardNames(db: LocalizationDb, cards: readonly { id: string; name: string; language?: string }[]): Promise<number> {
  if (!cards.length) return 0;
  const translations = await db.pokemonNameTranslation.findMany({ where: { englishKey: { in: [...new Set(cards.map(card => normalizePokemonNameKey(card.name)))] } } });
  const byName = new Map(translations.map(row => [row.englishKey, row]));
  let matched = 0;
  for (const card of [...cards].sort((a, b) => a.id < b.id ? -1 : 1)) {
    const translation = card.language === 'KO' ? undefined : byName.get(normalizePokemonNameKey(card.name));
    if (!translation) {
      await db.cardLocalizedName.deleteMany({ where: { cardVariantId: card.id, locale: 'ko', source: 'POKEAPI_SPECIES' } });
      continue;
    }
    const name = { name: translation.koreanName, source: 'POKEAPI_SPECIES' as const, sourceUrl: translation.sourceUrl, speciesId: translation.speciesId };
    await db.cardLocalizedName.upsert({
      where: { cardVariantId_locale: { cardVariantId: card.id, locale: 'ko' } },
      create: { cardVariantId: card.id, locale: 'ko', ...name }, update: name,
    });
    matched++;
  }
  return matched;
}

export function createPokemonLocalizationService({ prisma, provider, now = () => new Date() }: { prisma: PrismaClient; provider: PokemonNameProvider; now?: () => Date }) {
  return {
    async importNames() {
      const names = validatePokemonNames(await provider.loadNames());
      const importedAt = now();
      const data = names.map(row => ({ ...row, englishKey: normalizePokemonNameKey(row.englishName), importedAt }));
      return prisma.$transaction(async tx => {
        const created = await tx.pokemonNameTranslation.createMany({ data, skipDuplicates: true });
        const existing = await tx.pokemonNameTranslation.findMany({ where: { speciesId: { in: data.map(row => row.speciesId) } } });
        const byId = new Map(existing.map(row => [row.speciesId, row]));
        let updated = 0;
        for (const row of data) {
          const previous = byId.get(row.speciesId);
          if (!previous || previous.englishName !== row.englishName || previous.koreanName !== row.koreanName || previous.englishKey !== row.englishKey || previous.sourceUrl !== row.sourceUrl) {
            await tx.pokemonNameTranslation.upsert({ where: { speciesId: row.speciesId }, create: row, update: row });
            updated++;
          }
        }
        const cards = await tx.cardVariant.findMany({ where: { game: 'POKEMON', language: { not: 'KO' } }, select: { id: true, name: true, language: true, localizedNames: { select: { speciesId: true } } } });
        const incomingIds = new Set(data.map(row => row.speciesId));
        const incomingKeys = new Set(data.map(row => row.englishKey));
        const affected = cards.filter(card => incomingKeys.has(normalizePokemonNameKey(card.name)) || card.localizedNames.some(name => incomingIds.has(name.speciesId)));
        const matchedCards = await syncKoreanCardNames(tx, affected);
        const totalLocalizedCards = await tx.cardLocalizedName.count({ where: { locale: 'ko', source: 'POKEAPI_SPECIES', cardVariant: { game: 'POKEMON', language: { not: 'KO' } } } });
        return { dictionaryCount: data.length, inserted: created.count, updated, matchedCards, totalLocalizedCards, unmatchedCards: cards.length - totalLocalizedCards };
      }, { timeout: 60_000 });
    },
  };
}
