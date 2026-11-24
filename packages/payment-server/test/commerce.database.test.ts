import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createPrismaClient, seedDemoCatalog } from '@tcg/db';
import { createPrismaTradingStore, demoInventory } from '@tcg/trading';
import { createPolicyService } from '../src/index.js';
import { commerceFixture, buyer, request } from './commerce-fixture.js';

const url = process.env.DATABASE_TEST_URL;
it.skipIf(!url)('PostgreSQL에서 동시 제출·정책 수정·재시작 후 예산과 증빙을 보존한다', async () => {
  const prisma = createPrismaClient(url!);
  const second = createPrismaClient(url!);
  const inventory = demoInventory.slice(0,2).map(item => ({ ...item, id: randomUUID() }));
  let policyId: string | undefined;
  try {
    await seedDemoCatalog(prisma);
    await prisma.inventoryItem.createMany({ data: inventory });
    const f = await commerceFixture(createPrismaTradingStore(prisma), inventory); policyId = f.policy.id;
    vi.mocked(f.adapter.settle).mockResolvedValue({ status: 'UNKNOWN' });
    const quote = await f.reserve(0, '20000000');
    const quote2 = await f.reserve(1, '20000000');
    const inputs = await Promise.all([f.signed(quote), f.signed(quote2)]);
    const attempts = await Promise.allSettled(inputs.map(input => f.payments.processSignedPayment(input, buyer)));
    expect(attempts.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    expect(f.adapter.settle).toHaveBeenCalledTimes(1);
    const restarted = createPolicyService({ store: createPrismaTradingStore(second) });
    expect(await restarted.budget(buyer, policyId)).toMatchObject({ reservedAmount: '20000000', spentAmount: '0', availableAmount: '10000000' });
    await expect(restarted.update(buyer, policyId, { ...f.fields, totalBudget: '19999999', maxPerTrade: '1', expectedVersion: 1 }, request())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
    expect(await prisma.paymentAttempt.count({ where: { policyId, status: 'UNKNOWN' } })).toBe(1);
    const protectedQuote = await prisma.matchQuote.findFirst({ where: { policyId, status: 'RECONCILING' } });
    expect(protectedQuote?.paymentAttemptId).not.toBeNull();
    expect((await prisma.spendingPolicy.findUnique({ where: { id: policyId } }))?.version).toBe(1);
  } finally {
    try {
      if (policyId) await prisma.$transaction([
        prisma.trade.deleteMany({ where: { inventoryItemId: { in: inventory.map(item => item.id) } } }),
        prisma.paymentAttempt.deleteMany({ where: { policyId } }),
        prisma.matchQuote.deleteMany({ where: { inventoryItemId: { in: inventory.map(item => item.id) } } }),
        prisma.listing.deleteMany({ where: { inventoryItemId: { in: inventory.map(item => item.id) } } }),
        prisma.inventoryItem.deleteMany({ where: { id: { in: inventory.map(item => item.id) } } }),
        prisma.agentRun.deleteMany({ where: { policyId } }),
        prisma.policyVersion.deleteMany({ where: { policyId } }),
        prisma.spendingPolicy.deleteMany({ where: { id: policyId } }),
        prisma.tradingRequest.deleteMany({ where: { userId: buyer.userId } }),
      ]);
    } finally { await Promise.all([prisma.$disconnect(),second.$disconnect()]); }
  }
});
