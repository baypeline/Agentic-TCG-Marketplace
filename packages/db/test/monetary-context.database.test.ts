import { expect, it } from 'vitest';
import { createPrismaClient, ensureMonetaryContext, readDemoScenarios } from '../src/index.js';

it('마루 시드 가격은 18자리 tOKRW이고 기존 USDC 시드 값은 보존한다', async () => {
  const base = await readDemoScenarios(), maroo = await readDemoScenarios('maroo');
  expect(base.scenarios[0]!.listingPrices[0]).toBe('10000');
  expect(maroo.scenarios[0]!.listingPrices[0]).toBe('10000000000000000000');
  expect(maroo.scenarios[2]!.listingPrices[0]).toBe('5000000000000000000');
});
it.skipIf(!process.env.DATABASE_TEST_URL)('기존 USDC DB를 tOKRW로 재해석하지 않는다', async () => {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!);
  try {
    await ensureMonetaryContext(prisma, 'base-sepolia');
    const before = await prisma.monetaryContext.findUnique({ where: { id: 'settlement' } });
    await expect(ensureMonetaryContext(prisma, 'maroo')).rejects.toThrow();
    expect(await prisma.monetaryContext.findUnique({ where: { id: 'settlement' } })).toEqual(before);
  } finally { await prisma.$disconnect(); }
});
