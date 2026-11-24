import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient, readDemoScenarios, seedDemoScenarios } from '../src/index.js';
import { demoRowId } from '../src/demo-scenarios.js';

it.skipIf(!process.env.DATABASE_TEST_URL)('시나리오 시드 재실행은 구매 소유권과 판매 완료 상태를 보존한다', async () => {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
  const round = randomUUID(); const pack = await readDemoScenarios();
  const ids = pack.scenarios.flatMap(scene => scene.listingPrices.map((_, index) => ({ item: demoRowId(`inventory:${round}:${scene.id}:${index}`), listing: demoRowId(`listing:${round}:${scene.id}:${index}`) })));
  try {
    const result = await seedDemoScenarios(prisma, round);
    expect(result).toMatchObject({ inventory: 6, listings: 6 });
    const buyer = randomUUID();
    await prisma.inventoryItem.update({ where: { id: ids[0]!.item }, data: { ownerId: buyer, status: 'AVAILABLE' } });
    await prisma.listing.update({ where: { id: ids[0]!.listing }, data: { status: 'SOLD' } });
    expect(await seedDemoScenarios(prisma, round)).toMatchObject({ cards: 0, inventory: 0, listings: 0 });
    expect(await prisma.inventoryItem.findUnique({ where: { id: ids[0]!.item } })).toMatchObject({ ownerId: buyer, status: 'AVAILABLE' });
    expect(await prisma.listing.findUnique({ where: { id: ids[0]!.listing } })).toMatchObject({ status: 'SOLD' });
    expect(await prisma.priceObservation.count({ where: { cardVariantId: { in: pack.scenarios.map(scene => scene.cardId) }, dataSource: 'MOCK' } })).toBe(3);
  } finally {
    await prisma.listing.deleteMany({ where: { id: { in: ids.map(row => row.listing) } } });
    await prisma.inventoryItem.deleteMany({ where: { id: { in: ids.map(row => row.item) } } });
    await prisma.$disconnect();
  }
});
