import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AppError, type CardVariant } from '@tcg/contracts';
import type { PrismaClient } from '@tcg/db';
import { externalSetIdSchema, setPlanSchema, type SetCardSource, type SetPlan } from './set-source.js';
import { createPrismaCardCatalogWriter } from './prisma-card-catalog.js';
import { validateCollectionCards, type CardCatalogWriter } from './collection.js';

export interface SetCollectionProgress { runId: string; setId: string; language: string; status: string; totalCards: number; nextIndex: number; resumedFrom: number; storedThisRun: number }
export function createSetCollectionService({ prisma, source, writer = createPrismaCardCatalogWriter(prisma), now = () => new Date(), language: inputLanguage = 'en' }: { language?: 'en' | 'ko'; prisma: PrismaClient; source: SetCardSource; writer?: CardCatalogWriter; now?: () => Date }) {
  const language = z.enum(['en', 'ko']).parse(inputLanguage).toUpperCase();
  const leaseMs = 300_000;
  return { async collectSet(input: { setId: string; batchSize?: number; maxBatches?: number; refresh?: boolean; onProgress?: (progress: SetCollectionProgress) => void }) {
    const setId = externalSetIdSchema.parse(input.setId);
    const batchSize = z.number().int().min(1).max(20).parse(input.batchSize ?? 20);
    const maxBatches = z.number().int().min(1).max(2000).parse(input.maxBatches ?? 2000);
    const where = { collectionTarget: { provider: 'TCGDEX' as const, language, setId } };
    let run = await prisma.catalogCollectionRun.findUnique({ where });
    let newPlan: SetPlan | undefined;
    if (!run || input.refresh) {
      newPlan = setPlanSchema.parse(await source.getSet(setId));
      if (newPlan.setId !== setId) throw new AppError('INTERNAL_ERROR', '수집 세트가 요청한 세트와 다릅니다.', 502);
      await prisma.catalogCollectionRun.createMany({ data: [{ provider: 'TCGDEX', language, setId, setName: newPlan.setName, externalIds: newPlan.externalIds }], skipDuplicates: true });
      run = await prisma.catalogCollectionRun.findUniqueOrThrow({ where });
    }
    const plan = setPlanSchema.parse({ setId, setName: run!.setName, externalIds: run!.externalIds });
    if (run!.nextIndex < 0 || run!.nextIndex > plan.externalIds.length) throw new AppError('INTERNAL_ERROR', '수집 진행 상태가 올바르지 않습니다.', 500);
    const resumedFrom = input.refresh ? 0 : run!.nextIndex;
    let nextIndex = resumedFrom; let storedThisRun = 0;
    const progress = (status: string): SetCollectionProgress => ({ runId: run!.id, setId, language, status, totalCards: plan.externalIds.length, nextIndex, resumedFrom, storedThisRun });
    if (run!.status === 'COMPLETED' && !input.refresh) return progress('COMPLETED');
    const token = randomUUID(); const at = now();
    const acquired = await prisma.catalogCollectionRun.updateMany({
      where: { id: run!.id, OR: [{ leaseUntil: null }, { leaseUntil: { lte: at } }], ...(input.refresh ? {} : { status: { not: 'COMPLETED' as const } }) },
      data: { leaseToken: token, leaseUntil: new Date(at.getTime() + leaseMs), status: 'RUNNING', ...(input.refresh ? { nextIndex: 0, externalIds: newPlan!.externalIds, setName: newPlan!.setName } : {}) },
    });
    if (!acquired.count) throw new AppError('INTERNAL_ERROR', '같은 세트를 다른 작업이 수집 중입니다. 완료 후 다시 실행하세요.', 409, true);
    if (input.refresh) { plan.externalIds = newPlan!.externalIds; plan.setName = newPlan!.setName; }
    async function renew() {
      const at = now();
      const result = await prisma.catalogCollectionRun.updateMany({ where: { id: run!.id, leaseToken: token, leaseUntil: { gt: at } }, data: { leaseUntil: new Date(at.getTime() + leaseMs) } });
      if (!result.count) throw new AppError('INTERNAL_ERROR', '수집 잠금이 만료되어 중지했습니다. 다시 실행하면 이어서 수집합니다.', 409, true);
    }
    let succeeded = false;
    try {
      for (let batch = 0; batch < maxBatches && nextIndex < plan.externalIds.length; batch++) {
        await renew();
        const ids = plan.externalIds.slice(nextIndex, nextIndex + batchSize);
        const cards: CardVariant[] = new Array(ids.length); let next = 0; let failed = false;
        const workers = await Promise.allSettled(Array.from({ length: Math.min(2, ids.length) }, async () => {
          while (!failed && next < ids.length) {
            const index = next++;
            try {
              const card = await source.getCard(ids[index]!, setId);
              if (card.setCode !== setId || card.language !== language) throw new AppError('INTERNAL_ERROR', '세트 카드의 식별 속성이 올바르지 않습니다.', 502);
              cards[index] = card;
            } catch (error) { failed = true; throw error; }
          }
        }));
        const rejected = workers.find(result => result.status === 'rejected');
        if (rejected?.status === 'rejected') throw rejected.reason;
        validateCollectionCards(cards);
        await renew();
        const saved = await writer.saveCards({ cards, collectedAt: now().toISOString() });
        if (saved.length !== ids.length) throw new AppError('INTERNAL_ERROR', '저장된 카드 수가 수집 배치와 다릅니다.', 500);
        const previousIndex = nextIndex;
        nextIndex += ids.length;
        const advanced = await prisma.catalogCollectionRun.updateMany({ where: { id: run!.id, leaseToken: token, nextIndex: previousIndex, leaseUntil: { gt: now() } }, data: { nextIndex } });
        if (!advanced.count) throw new AppError('INTERNAL_ERROR', '수집 체크포인트를 저장하지 못했습니다. 같은 배치를 안전하게 재실행할 수 있습니다.', 409, true);
        storedThisRun += saved.length;
        input.onProgress?.(progress('RUNNING'));
      }
      succeeded = true;
      return progress(nextIndex === plan.externalIds.length ? 'COMPLETED' : 'PENDING');
    } finally {
      await prisma.catalogCollectionRun.updateMany({ where: { id: run!.id, leaseToken: token }, data: { leaseToken: null, leaseUntil: null, status: succeeded ? (nextIndex === plan.externalIds.length ? 'COMPLETED' : 'PENDING') : 'FAILED' } });
    }
  } };
}
