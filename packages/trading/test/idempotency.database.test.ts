import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient, seedDemoCatalog } from '@tcg/db';
import { demoCards } from '@tcg/contracts/fixtures';
import { createPrismaTradingStore, createTradingService } from '../src/index.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
it.skipIf(!databaseUrl)('별도 서비스의 동시 주문과 재시작 후 재시도에서 요청 키를 보존한다', async () => {
  const clients = [createPrismaClient(databaseUrl!), createPrismaClient(databaseUrl!)];
  const buyer = { userId: randomUUID(), agentId: randomUUID() };
  const input = { cardVariantId: demoCards[0]!.id, maxPrice: '10000000', expiresAt: '2098-01-01T00:00:00.000Z' };
  const context = { idempotencyKey: randomUUID() };
  try {
    await seedDemoCatalog(clients[0]!);
    const services = clients.map(prisma => createTradingService({ store: createPrismaTradingStore(prisma) }));
    const results = await Promise.all(services.map(service => service.createBuyOrder(buyer, input, context)));
    expect(results[0]).toEqual(results[1]);
    expect(await clients[0]!.buyOrder.count({ where: { buyerId: buyer.userId } })).toBe(1);
    expect(await clients[0]!.tradingRequest.count({ where: { userId: buyer.userId } })).toBe(1);
    const restarted = createTradingService({ store: createPrismaTradingStore(clients[1]!) });
    expect(await restarted.createBuyOrder(buyer, input, context)).toEqual(results[0]);
    await expect(restarted.createBuyOrder(buyer, { ...input, maxPrice: '1' }, context)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  } finally {
    try {
      await clients[0]!.$transaction([
        clients[0]!.tradingRequest.deleteMany({ where: { userId: buyer.userId } }),
        clients[0]!.buyOrder.deleteMany({ where: { buyerId: buyer.userId } }),
      ]);
    } finally { await Promise.all(clients.map(prisma => prisma.$disconnect())); }
  }
});
