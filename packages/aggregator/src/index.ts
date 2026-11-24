import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@tcg/db';
import { demoCards } from '@tcg/contracts/fixtures';
import { toCardVariant } from './card-dto.js';
import { AppError, cardParamsSchema, cardSearchQuerySchema, cardSearchResponseSchema, cardVariantSchema, type AggregatorService, type CardVariant } from '@tcg/contracts';

export type { AggregatorService } from '@tcg/contracts';
export { createTcgdexCardAdapter, TcgdexAdapterError } from './tcgdex.js';
export type { TcgdexCardAdapterOptions, TcgdexCardAdapter, TcgdexFailure, TcgdexLanguage } from './tcgdex.js';
export { createTcgdexSetSource } from './set-source.js';
export type { SetCardSource, SetPlan } from './set-source.js';
export { createSetCollectionService } from './set-collection.js';
export type { SetCollectionProgress } from './set-collection.js';
export { createInMemoryCardIdentityStore } from './card-identity.js';
export { createPrismaCardIdentityStore } from './prisma-card-identity.js';
export type { CardIdentityStore, ExternalCardReference } from './card-identity.js';
export { createCardCollectionService, CardCollectionError } from './collection.js';
export type { CardCatalogWriter, CardCollectionDependencies, CardCollectionService, CardCollectionResult, CardCollectionFailure } from './collection.js';
export { createPrismaCardCatalogWriter } from './prisma-card-catalog.js';
export { createPokeApiNameProvider, PokemonNameImportError, pokeApiNamesSourceUrl } from './pokemon-names.js';
export type { PokemonNameProvider, PokemonNameTranslation } from './pokemon-names.js';
export { createPokemonLocalizationService } from './prisma-localization.js';
export interface CardDataAdapter {
  searchCards(input: { query: string; limit: number }): Promise<CardVariant[]>;
  getCardVariant(id: string): Promise<CardVariant | null>;
}
export interface AggregatorDependencies { adapter: CardDataAdapter }
export function createAggregatorService({ adapter }: AggregatorDependencies): AggregatorService {
  return {
    async searchCards(input) { return (await adapter.searchCards(input)).map(card => cardVariantSchema.parse(card)); },
    async getCardVariant(id) { const card = await adapter.getCardVariant(id); return card === null ? null : cardVariantSchema.parse(card); },
  };
}
export const mockCards = demoCards;
export function createMockCardAdapter(cards: readonly CardVariant[] = mockCards): CardDataAdapter {
  return {
    async searchCards({ query, limit }) {
      const search = query.normalize('NFKC').trim().toLowerCase();
      return cards.filter(card => card.name.toLowerCase().includes(search) || card.localizedNames?.some(name => name.name.normalize('NFKC').toLowerCase().includes(search))).slice(0, limit).map(card => structuredClone(card));
    },
    async getCardVariant(id) { const card = cards.find(card => card.id === id); return card ? structuredClone(card) : null; },
  };
}
export function createPrismaCardAdapter(prisma: PrismaClient, options: { cardIds?: readonly string[] } = {}): CardDataAdapter {
  return {
    async searchCards({ query, limit }) {
      const search = query.normalize('NFKC').trim().replace(/[\\%_]/g, character => `\\${character}`);
      const rows = await prisma.cardVariant.findMany({
        where: { ...(options.cardIds ? { id: { in: [...options.cardIds] } } : {}), OR: [{ name: { contains: search, mode: 'insensitive' } }, { localizedNames: { some: { locale: 'ko', name: { contains: search, mode: 'insensitive' } } } }] },
        include: { localizedNames: { orderBy: { locale: 'asc' } } },
        orderBy: { id: 'asc' }, take: limit,
      });
      return rows.map(toCardVariant);
    },
    async getCardVariant(id) {
      const row = await prisma.cardVariant.findUnique({ where: { id }, include: { localizedNames: { orderBy: { locale: 'asc' } } } });
      return row ? toCardVariant(row) : null;
    },
  };
}
export interface AggregatorPluginDependencies { aggregatorService: AggregatorService }
// 호스트에서 prefix: '/api'로 등록한다. Service는 HTTP에 종속되지 않는다.
export function createAggregatorPlugin({ aggregatorService }: AggregatorPluginDependencies): FastifyPluginAsync {
  return async app => {
    app.get('/cards', async request => {
      const { q, limit } = cardSearchQuerySchema.parse(request.query);
      return cardSearchResponseSchema.parse({ items: await aggregatorService.searchCards({ query: q, limit }), nextCursor: null });
    });
    app.get('/cards/:id', async request => {
      const { id } = cardParamsSchema.parse(request.params);
      const card = await aggregatorService.getCardVariant(id);
      if (!card) throw new AppError('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.', 404);
      return cardVariantSchema.parse(card);
    });
  };
}
