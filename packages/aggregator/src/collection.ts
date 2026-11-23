import { AppError, cardSearchQuerySchema, cardVariantSchema, timestampSchema, type CardVariant } from '@tcg/contracts';
import type { CardDataAdapter } from './index.js';

export type CardCollectionFailure = 'INVALID_CARD' | 'DUPLICATE_CARD' | 'IDENTITY_NOT_FOUND' | 'IDENTITY_MISMATCH' | 'VARIANT_CONFLICT';
export class CardCollectionError extends AppError {
  constructor(public readonly reason: CardCollectionFailure) {
    super('INTERNAL_ERROR', {
      INVALID_CARD: '수집 카드의 응답 형식이 올바르지 않습니다.',
      DUPLICATE_CARD: '수집 결과에 같은 내부 UUID가 중복되어 있습니다.',
      IDENTITY_NOT_FOUND: '수집 카드의 영구 UUID 매핑이 없습니다.',
      IDENTITY_MISMATCH: '수집 카드의 식별 속성과 UUID 매핑이 일치하지 않습니다.',
      VARIANT_CONFLICT: '동일한 카드 변형이 다른 UUID로 저장되어 있습니다. 매핑 확인이 필요합니다.',
    }[reason], 500);
  }
}

export interface CardCatalogWriter {
  saveCards(input: { cards: readonly CardVariant[]; collectedAt: string }): Promise<CardVariant[]>;
}
export interface CardCollectionResult { items: CardVariant[]; storedCount: number; collectedAt: string }
export interface CardCollectionService {
  collectCards(input: { query: string; limit: number }): Promise<CardCollectionResult>;
}
export interface CardCollectionDependencies {
  source: CardDataAdapter;
  writer: CardCatalogWriter;
  now?: () => Date;
}

export function validateCollectionCards(input: readonly CardVariant[]): CardVariant[] {
  if (input.length > 100) throw new CardCollectionError('INVALID_CARD');
  const cards = input.map(value => {
    const result = cardVariantSchema.safeParse(value);
    if (!result.success) throw new CardCollectionError('INVALID_CARD');
    return { ...result.data, id: result.data.id.toLowerCase() };
  });
  if (new Set(cards.map(card => card.id)).size !== cards.length) throw new CardCollectionError('DUPLICATE_CARD');
  return cards;
}

/** 네트워크 조회를 마친 뒤에만 저장을 시작한다. 쓰기 요청을 외부 REST에 노출하지 않는다. */
export function createCardCollectionService({ source, writer, now = () => new Date() }: CardCollectionDependencies): CardCollectionService {
  return {
    async collectCards(input) {
      const { q, limit } = cardSearchQuerySchema.parse({ q: input.query, limit: input.limit });
      const cards = validateCollectionCards(await source.searchCards({ query: q, limit }));
      if (cards.length > limit) throw new CardCollectionError('INVALID_CARD');
      const collectedAt = timestampSchema.parse(now().toISOString());
      const items = cards.length ? await writer.saveCards({ cards, collectedAt }) : [];
      return { items, storedCount: items.length, collectedAt };
    },
  };
}
