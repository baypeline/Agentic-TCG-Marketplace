import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { idSchema, amountSchema, timestampSchema } from '@tcg/contracts';
import type { PrismaClient } from './generated/prisma/client.js';
import { readCatalogFixtures } from './catalog-fixtures.js';

const price = amountSchema.refine(value => BigInt(value) > 0n);
const scenarioSchema = z.object({
  id: z.string().regex(/^[a-z]+$/), cardId: idSchema, sourceCardId: idSchema,
  koreanName: z.string().min(1), speciesId: z.number().int().positive(),
  edition: z.string().min(1), condition: z.string().min(1), referencePrice: price,
  listingPrices: z.array(price).min(1).max(10), suggestion: z.string().min(1),
});
const packSchema = z.object({ version: z.literal(1), mode: z.literal('SYNTHETIC_DEMO'), observedAt: timestampSchema, sellerId: idSchema, scenarios: z.array(scenarioSchema).length(3) });
export type DemoScenarioPack = z.infer<typeof packSchema>;
export async function readDemoScenarios(): Promise<DemoScenarioPack> {
  return packSchema.parse(JSON.parse(await readFile(new URL('../fixtures/demo/scenarios.json', import.meta.url), 'utf8')));
}

export function demoRowId(key: string) {
  const hex = createHash('sha256').update(`tcg-scenario-v1:${key}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** 독립된 합성 카드·가격·판매 재고만 추가한다. 재실행으로 체결·소유권을 되돌리지 않는다. */
export async function seedDemoScenarios(prisma: PrismaClient, round = 'default') {
  z.string().regex(/^[A-Za-z0-9_-]{1,40}$/).parse(round);
  const [pack, catalog] = await Promise.all([readDemoScenarios(), readCatalogFixtures()]);
  return prisma.$transaction(async tx => {
    let cards = 0; let inventory = 0; let listings = 0;
    for (const scenario of pack.scenarios) {
      const source = catalog.cards.find(card => card.id === scenario.sourceCardId);
      if (!source) throw new Error('데모의 원본 카드를 찾을 수 없습니다.');
      const { externalIdentityId: _identity, lastCollectedAt: _collected, id: _id, ...metadata } = source;
      const data = { ...metadata, id: scenario.cardId, edition: scenario.edition, condition: scenario.condition };
      const existing = await tx.cardVariant.findUnique({ where: { id: scenario.cardId } });
      if (existing && ['name', 'game', 'setCode', 'cardNumber', 'language', 'edition', 'condition'].some(key => existing[key as keyof typeof existing] !== data[key as keyof typeof data])) throw new Error('기존 데모 카드의 식별 속성이 달라 시드를 중단합니다.');
      cards += (await tx.cardVariant.createMany({ data: [data], skipDuplicates: true })).count;
      const translation = catalog.koreanNames.translations.find(row => row.speciesId === scenario.speciesId)!;
      await tx.pokemonNameTranslation.createMany({ data: [{ ...translation, importedAt: new Date(translation.importedAt) }], skipDuplicates: true });
      await tx.cardLocalizedName.createMany({ data: [{ cardVariantId: scenario.cardId, locale: 'ko', name: scenario.koreanName, speciesId: scenario.speciesId, source: 'POKEAPI_SPECIES', sourceUrl: translation.sourceUrl }], skipDuplicates: true });
      await tx.priceObservation.createMany({ data: [{ id: demoRowId(`price:${scenario.id}`), cardVariantId: scenario.cardId, amount: scenario.referencePrice, dataSource: 'MOCK', source: '고정 데모 합성 시세 · 실제 시장가격이 아닙니다.', observedAt: new Date(pack.observedAt) }], skipDuplicates: true });
      for (const [index, amount] of scenario.listingPrices.entries()) {
        const inventoryId = demoRowId(`inventory:${round}:${scenario.id}:${index}`);
        const listingId = demoRowId(`listing:${round}:${scenario.id}:${index}`);
        const item = await tx.inventoryItem.findUnique({ where: { id: inventoryId } });
        if (item && item.cardVariantId !== scenario.cardId) throw new Error('데모 재고 식별자가 다른 카드에 사용 중입니다.');
        inventory += (await tx.inventoryItem.createMany({ data: [{ id: inventoryId, cardVariantId: scenario.cardId, ownerId: pack.sellerId, status: 'LISTED' }], skipDuplicates: true })).count;
        if (!item || (item.ownerId === pack.sellerId && item.status === 'LISTED')) listings += (await tx.listing.createMany({ data: [{ id: listingId, inventoryItemId: inventoryId, cardVariantId: scenario.cardId, sellerId: pack.sellerId, price: amount, status: 'ACTIVE', createdAt: new Date(pack.observedAt) }], skipDuplicates: true })).count;
      }
    }
    return { mode: pack.mode, round, cards, inventory, listings };
  });
}
