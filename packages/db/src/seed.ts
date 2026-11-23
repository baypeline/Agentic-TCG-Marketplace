import { demoCards, demoPriceObservations } from '@tcg/contracts/fixtures';
import type { PrismaClient } from './generated/prisma/client.js';

/** 고정 ID만 upsert한다. 전체 테이블 삭제나 기존 사용자 데이터 초기화는 하지 않는다. */
export async function seedDemoCatalog(prisma: PrismaClient): Promise<void> {
  await prisma.$transaction(async tx => {
    for (const card of demoCards) {
      const { localizedNames: _displayNames, ...data } = card;
      await tx.cardVariant.upsert({ where: { id: card.id }, create: data, update: data });
    }
    for (const observation of demoPriceObservations) {
      const data = { ...observation, observedAt: new Date(observation.observedAt) };
      await tx.priceObservation.upsert({ where: { id: data.id }, create: data, update: data });
    }
  });
}
