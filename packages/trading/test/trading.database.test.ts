import { allowExecution } from './helpers.js';
import { randomUUID } from 'node:crypto';
import { demoCards } from '@tcg/contracts/fixtures';
import { createPrismaClient, seedDemoCatalog } from '@tcg/db';
import { expect, it } from 'vitest';
import { createPrismaTradingStore, createTradingService, type PaymentRecord } from '../src/index.js';

const databaseUrl = process.env.DATABASE_TEST_URL;

it.skipIf(!databaseUrl)('enforces reservation and settlement uniqueness across separate service instances', async () => {
  const prisma = createPrismaClient(databaseUrl!);
  const otherPrisma = createPrismaClient(databaseUrl!);
  const seller = { userId: randomUUID() };
  const buyers = Array.from({ length: 2 }, () => ({ userId: randomUUID(), agentId: randomUUID() }));
  const records = new Map<string, PaymentRecord>();
  const payment = { async getPaymentRecord(id: string) { return records.get(id) ?? null; } };
  const services = [prisma, otherPrisma].map(client => createTradingService({ executionContext: allowExecution, store: createPrismaTradingStore(client), payment }));
  const inventoryItemId = randomUUID();
  const price = '10000000';

  try {
    await seedDemoCatalog(prisma);
    await prisma.inventoryItem.create({ data: { id: inventoryItemId, ownerId: seller.userId, cardVariantId: demoCards[0]!.id } });
    const listings = await Promise.allSettled(services.map(service => service.createListing(seller, { inventoryItemId, price }, { idempotencyKey: randomUUID() })));
    const [listing] = listings.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
    expect(listings.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(prisma.listing.create({ data: {
      id: randomUUID(), inventoryItemId, cardVariantId: listing!.cardVariantId, sellerId: seller.userId,
      price, status: 'ACTIVE', createdAt: new Date(),
    } })).rejects.toMatchObject({ code: 'P2002' });

    const results = await Promise.allSettled(services.map((service, index) =>
      service.quoteFixedPurchase(buyers[index]!, { listingId: listing!.id, maxPrice: price }, { idempotencyKey: randomUUID() }),
    ));
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const winner = results.findIndex(result => result.status === 'fulfilled');
    const quote = (results[winner] as PromiseFulfilledResult<Awaited<ReturnType<typeof services[number]['quoteFixedPurchase']>>>).value;
    const attempt = randomUUID();
    await services[winner]!.beginPayment(quote.id, attempt);
    records.set(attempt, { paymentAttemptId: attempt, matchQuoteId: quote.id, amount: price, currency: 'USDC', status: 'SETTLED' });
    const trades = await Promise.all(services.map(service => service.finalizeTrade(quote.id, attempt)));
    expect(trades[0]).toEqual(trades[1]);
    expect(await prisma.trade.count({ where: { inventoryItemId } })).toBe(1);
    expect(await prisma.inventoryItem.findUnique({ where: { id: inventoryItemId } })).toMatchObject({
      ownerId: buyers[winner]!.userId, status: 'AVAILABLE',
    });
  } finally {
    try {
      await prisma.$transaction([
        prisma.tradingRequest.deleteMany({ where: { userId: { in: [seller.userId, ...buyers.map(buyer => buyer.userId)] } } }),
        prisma.trade.deleteMany({ where: { inventoryItemId } }),
        prisma.matchQuote.deleteMany({ where: { inventoryItemId } }),
        prisma.listing.deleteMany({ where: { inventoryItemId } }),
        prisma.inventoryItem.deleteMany({ where: { id: inventoryItemId } }),
      ]);
    } finally {
      await Promise.all([prisma.$disconnect(), otherPrisma.$disconnect()]);
    }
  }
});
