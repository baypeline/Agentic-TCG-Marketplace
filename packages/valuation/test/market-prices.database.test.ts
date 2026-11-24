import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { createMarketPriceServices, createValuationService, type SnapshotInput } from '../src/index.js';

const at = new Date('2026-11-22T12:00:00Z');
const observedAt = '2026-11-22T00:00:00Z';
const integration = it.skipIf(!process.env.DATABASE_TEST_URL);
async function fixture(run: (ctx: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const ctx = await setup();
  try { await run(ctx); }
  finally {
    await ctx.prisma.marketPriceSnapshot.deleteMany({ where: { cardVariantId: ctx.id } });
    await ctx.prisma.cardVariant.deleteMany({ where: { id: ctx.id } });
    await ctx.prisma.externalCardIdentity.deleteMany({ where: { id: ctx.id } });
    await ctx.prisma.$disconnect();
  }
}
async function setup() {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!); const id = randomUUID();
  const externalId = `test-${id}`;
  await prisma.externalCardIdentity.create({ data: { id, provider: 'TCGDEX', externalId, language: 'EN', edition: 'NORMAL', condition: 'NM' } });
  const card = await prisma.cardVariant.create({ data: { id, game: 'POKEMON', name: 'Price test', setCode: externalId, cardNumber: '1', language: 'EN', edition: 'NORMAL', condition: 'NM', externalIdentityId: id } });
  const sample: SnapshotInput = { provider: 'TCGPLAYER', externalId, providerVariant: 'normal', priceType: 'PROVIDER_MARKET', originalCurrency: 'USD', originalAmount: '12.345678', sourceUrl: `https://example.test/${externalId}`, observedAt };
  const inputs = [sample]; let clock = at;
  const service = createMarketPriceServices({ prisma, provider: { async getPrices() { return structuredClone(inputs); } }, now: () => clock });
  const aggregatorService = { async searchCards() { return []; }, async getCardVariant() { return { ...card, game: 'POKEMON' as const, imageUrl: undefined }; } };
  const valuation = createValuationService({ aggregatorService, adapter: service.adapter, now: () => clock });
  function assessment(snapshotId: string) { return { snapshotId, language: 'EN', edition: 'NORMAL', condition: 'NM', matchEvidenceUrl: 'https://example.test/verified-variant', fxRate: '0.999999', fxSourceUrl: 'https://example.test/usd-usdc', fxObservedAt: observedAt }; }
  return { prisma, id, inputs, sample, service, valuation, assessment, setTime(date: Date) { clock = date; } };
}
integration('동시 수집과 재실행은 중복하지 않으며 미검증 가격을 적정가에 포함하지 않는다', async () => fixture(async c => {
  const results = await Promise.all([c.service.collectPrices(c.id), c.service.collectPrices(c.id)]);
  expect(results.reduce((sum, r) => sum + r.inserted, 0)).toBe(1);
  expect((await c.service.collectPrices(c.id)).inserted).toBe(0);
  const prices = await c.service.marketPriceService.getPrices(c.id);
  expect(prices.items).toHaveLength(1);
  expect(prices.items[0]).toMatchObject({ eligibility: 'UNVERIFIED_VARIANT', originalCurrency: 'USD' });
  expect(await c.valuation.getValuation(c.id)).toMatchObject({ dataSource: 'MARKET', status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0 });
}));

integration('데모는 미확정 카드의 USD 시장 집계가를 1:1 환산하고 검증 기록을 만들지 않는다', async () => fixture(async c => {
  await c.prisma.cardVariant.update({ where: { id: c.id }, data: { edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' } });
  c.inputs.push({ ...c.sample, providerVariant: 'holofoil', originalAmount: '999' });
  await c.service.collectPrices(c.id);
  const aggregatorService = { async searchCards() { return []; }, async getCardVariant() { return { id: c.id, game: 'POKEMON' as const, name: 'Demo', setCode: 'test', cardNumber: '1', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' }; } };
  const demo = createValuationService({ aggregatorService, adapter: c.service.demoAdapter, now: () => at });
  expect(await demo.getValuation(c.id)).toMatchObject({ status: 'AVAILABLE', estimatedPrice: '12345678', sampleSize: 1, dataSource: 'MARKET', methodology: 'DEMO_USD_REFERENCE', confidence: 'LOW', assumptions: expect.arrayContaining([expect.stringContaining('1 USD ≈ 1 USDC')]) });
  expect((await c.service.marketPriceService.getPrices(c.id)).items.every(price => !price.assessment && price.eligibility === 'UNVERIFIED_VARIANT')).toBe(true);
  expect((await c.valuation.getValuation(c.id)).status).toBe('INSUFFICIENT_DATA');
}));
integration('속성과 환율을 확인한 가격만 정수 정밀도로 환산하고 속성 변경 시 제외한다', async () => fixture(async c => {
  await c.service.collectPrices(c.id);
  const snapshot = (await c.service.marketPriceService.getPrices(c.id)).items[0]!;
  await c.service.assessPrice(c.assessment(snapshot.id));
  expect(await c.valuation.getValuation(c.id)).toMatchObject({ status: 'AVAILABLE', estimatedPrice: '12345665', sampleSize: 1, dataSource: 'MARKET', confidence: 'LOW', methodology: 'MEDIAN_OF_PROVIDER_AGGREGATES', oldestObservedAt: '2026-11-22T00:00:00.000Z' });
  expect((await c.service.marketPriceService.getPrices(c.id)).items[0]!.eligibility).toBe('ELIGIBLE');
  await c.prisma.cardVariant.update({ where: { id: c.id }, data: { condition: 'LP' } });
  expect((await c.service.marketPriceService.getPrices(c.id)).items[0]!.eligibility).toBe('VARIANT_MISMATCH');
  expect((await c.valuation.getValuation(c.id)).status).toBe('INSUFFICIENT_DATA');
}));
integration('오래된 환율과 가격은 만료되고 이후 스냅샷은 다시 검증해야 한다', async () => fixture(async c => {
  await c.service.collectPrices(c.id);
  const original = (await c.service.marketPriceService.getPrices(c.id)).items[0]!;
  await c.service.assessPrice(c.assessment(original.id));
  c.setTime(new Date('2026-11-23T12:00:00Z'));
  expect((await c.service.marketPriceService.getPrices(c.id)).items[0]!.eligibility).toBe('STALE_FX');
  c.setTime(new Date('2026-11-26T12:00:00Z'));
  expect((await c.service.marketPriceService.getPrices(c.id)).items[0]!.eligibility).toBe('STALE_PRICE');
  expect((await c.valuation.getValuation(c.id)).estimatedPrice).toBeNull();
  c.setTime(at);
  c.inputs[0] = { ...c.sample, observedAt: '2026-11-22T06:00:00Z', originalAmount: '13' };
  await c.service.collectPrices(c.id);
  expect((await c.service.marketPriceService.getPrices(c.id)).items).toHaveLength(1);
  expect((await c.valuation.getValuation(c.id)).status).toBe('INSUFFICIENT_DATA');
}));
integration('동일 시각 가격 충돌과 잘못된 배치는 전체 롤백하고 기존 가격을 보존한다', async () => fixture(async c => {
  await c.service.collectPrices(c.id);
  c.inputs.push({ ...c.sample, priceType: 'ASKING_LOW', originalAmount: '10' });
  c.inputs[0] = { ...c.sample, originalAmount: '999' };
  await expect(c.service.collectPrices(c.id)).rejects.toMatchObject({ reason: 'SNAPSHOT_CONFLICT' });
  expect(await c.prisma.marketPriceSnapshot.count({ where: { cardVariantId: c.id } })).toBe(1);
  c.inputs[0] = { ...c.sample, observedAt: '2027-01-01T00:00:00Z' };
  await expect(c.service.collectPrices(c.id)).rejects.toMatchObject({ reason: 'INVALID_DATA' });
  expect(await c.prisma.marketPriceSnapshot.count({ where: { cardVariantId: c.id } })).toBe(1);
}));
integration('판매 희망가·미확정 속성·다른 언어·미래 환율은 승인하지 않는다', async () => fixture(async c => {
  c.inputs[0] = { ...c.sample, priceType: 'ASKING_LOW' };
  await c.service.collectPrices(c.id);
  const id = (await c.service.marketPriceService.getPrices(c.id)).items[0]!.id;
  await expect(c.service.assessPrice(c.assessment(id))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  c.inputs[0] = c.sample;
  await c.service.collectPrices(c.id);
  const row = (await c.service.marketPriceService.getPrices(c.id)).items.find(item => item.priceType === 'PROVIDER_MARKET')!;
  for (const values of [{ language: 'KO' }, { fxObservedAt: '2026-12-01T00:00:00Z' }, { fxObservedAt: '2026-11-01T00:00:00Z' }]) await expect(c.service.assessPrice({ ...c.assessment(row.id), ...values })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  await expect(c.service.assessPrice({ ...c.assessment(row.id), condition: 'UNSPECIFIED' })).rejects.toThrow();
}));
