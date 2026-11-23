import type { PrismaClient } from '@tcg/db';
import { timestampSchema } from '@tcg/contracts';
import { toCardVariant } from './card-dto.js';
import { syncKoreanCardNames } from './prisma-localization.js';
import { CardCollectionError, validateCollectionCards, type CardCatalogWriter } from './collection.js';

const variantFields = ['game', 'setCode', 'cardNumber', 'language', 'edition', 'condition'] as const;

export function createPrismaCardCatalogWriter(prisma: PrismaClient): CardCatalogWriter {
  return {
    async saveCards(input) {
      const cards = validateCollectionCards(input.cards);
      const collectedAt = new Date(timestampSchema.parse(input.collectedAt));
      if (!cards.length) return [];
      // 일정한 순서로 써서 동시 수집 배치 간 잠금 순서를 맞춘다.
      const ordered = [...cards].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      return prisma.$transaction(async tx => {
        for (const card of ordered) {
          const identity = await tx.externalCardIdentity.findUnique({ where: { id: card.id } });
          if (!identity) throw new CardCollectionError('IDENTITY_NOT_FOUND');
          if (identity.language !== card.language || identity.edition !== card.edition || identity.condition !== card.condition) {
            throw new CardCollectionError('IDENTITY_MISMATCH');
          }
          const { id, localizedNames: _untrustedNames, ...attributes } = card;
          const data = { ...attributes, imageUrl: card.imageUrl ?? null, externalIdentityId: id, lastCollectedAt: collectedAt };
          // 동시 수집과 기존 변형의 충돌은 DB 제약으로 감지하며 UUID를 재할당하지 않는다.
          await tx.cardVariant.createMany({ data: [{ id, ...data }], skipDuplicates: true });
          const existing = await tx.cardVariant.findUnique({ where: { id } });
          if (!existing) throw new CardCollectionError('VARIANT_CONFLICT');
          if (variantFields.some(field => existing[field] !== card[field]) || (existing.externalIdentityId !== null && existing.externalIdentityId !== id)) {
            throw new CardCollectionError('IDENTITY_MISMATCH');
          }
          // 오래된 배치가 늦게 끝나더라도 최신 카드 정보를 덮어쓰지 않는다.
          await tx.cardVariant.updateMany({
            where: { id, OR: [{ lastCollectedAt: null }, { lastCollectedAt: { lte: collectedAt } }] },
            data: { name: card.name, imageUrl: card.imageUrl ?? null, externalIdentityId: id, lastCollectedAt: collectedAt },
          });
        }
        const rows = await tx.cardVariant.findMany({ where: { id: { in: cards.map(card => card.id) } } });
        await syncKoreanCardNames(tx, rows);
        const localized = await tx.cardVariant.findMany({ where: { id: { in: cards.map(card => card.id) } }, include: { localizedNames: { orderBy: { locale: 'asc' } } } });
        const byId = new Map(localized.map(row => [row.id, row]));
        return cards.map(card => toCardVariant(byId.get(card.id)!));
      }, { timeout: 15_000 });
    },
  };
}
