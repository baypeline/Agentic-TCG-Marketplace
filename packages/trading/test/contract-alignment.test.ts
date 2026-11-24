import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { SpendingPolicy, TradingExecutionContextReader } from '@tcg/contracts';
import { createMockTradingStore, createTradingService, demoInventory, demoSellerId, type PaymentRecord } from '../src/index.js';

const seller = { userId: demoSellerId };
const buyer = { userId: randomUUID(), agentId: randomUUID() };
const other = { userId: randomUUID(), agentId: randomUUID() };
const card = demoInventory[0]!;
const context = () => ({ idempotencyKey: randomUUID() });

it.each([
  ['MOCK', '10000000', false], ['MARKET', '10200000', true], ['MARKET', '10200001', false],
] as const)('할인 정책은 실제 시세와 정확한 금액 경계로 검사한다: %s %s', async (dataSource, price, allowed) => {
  const service = createTradingService({
    store: createMockTradingStore(),
    executionContext: { async getExecutionContext() { return { online: true, policy: { id: '00000000-0000-4000-8004-000000000001', version: 1, agentId: buyer.agentId, enabled: true, totalBudget: '100000000', maxPerTrade: '20000000', minDiscountPercent: 15, validUntil: '2099-01-01T00:00:00.000Z' } }; } },
    valuationService: { async getValuation() { return { cardVariantId: card.cardVariantId, currency: 'USDC', sampleSize: 1, confidence: 'LOW', evaluatedAt: new Date().toISOString(), dataSource, status: 'AVAILABLE', estimatedPrice: '12000000', sourceSummary: ['test'] }; } },
  });
  const listing = await service.createListing(seller, { inventoryItemId: card.id, price }, context());
  const promise = service.quoteFixedPurchase(buyer, { listingId: listing.id, maxPrice: '20000000' }, context());
  if (allowed) expect(await promise).toMatchObject({ status: 'RESERVED' });
  else await expect(promise).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
});
function setup() {
  let online = true;
  let policy: SpendingPolicy = { id: '00000000-0000-4000-8004-000000000001', version: 1, agentId: buyer.agentId, enabled: true, totalBudget: '100000000', maxPerTrade: '20000000', allowedCardVariantIds: [card.cardVariantId], validUntil: '2099-01-01T00:00:00.000Z' };
  const records = new Map<string, PaymentRecord>();
  const executionContext: TradingExecutionContextReader = { async getExecutionContext(auth) { return auth.userId === buyer.userId && auth.agentId === buyer.agentId ? { online, policy } : null; } };
  const service = createTradingService({ store: createMockTradingStore(), executionContext, payment: { async getPaymentRecord(id) { return records.get(id) ?? null; } } });
  return { service, records, setOnline(value: boolean) { online = value; }, setPolicy(value: Partial<SpendingPolicy>) { policy = { ...policy, ...value }; } };
}

it('같은 키의 동시 등록은 하나의 결과를 반환하고 다른 입력 재사용은 거부한다', async () => {
  const { service } = setup();
  const key = context();
  const input = { cardVariantId: card.cardVariantId, maxPrice: '10000000', expiresAt: '2098-01-01T00:00:00.000Z' };
  const orders = await Promise.all([service.createBuyOrder(buyer, input, key), service.createBuyOrder(buyer, input, key)]);
  expect(orders[0]).toEqual(orders[1]);
  expect(await service.listBuyOrders(buyer)).toHaveLength(1);
  await expect(service.createBuyOrder(buyer, { ...input, maxPrice: '1' }, key)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect((await service.createBuyOrder(other, input, key)).id).not.toBe(orders[0]!.id);
  const listingInput = { inventoryItemId: card.id, price: '10000000' };
  const listed = await service.createListing(seller, listingInput, key);
  expect(await service.createListing(seller, listingInput, key)).toEqual(listed);
  const quoteInput = { listingId: listed.id, maxPrice: '10000000' };
  const quote = await service.quoteFixedPurchase(buyer, quoteInput, key);
  expect(await service.quoteFixedPurchase(buyer, quoteInput, key)).toEqual(quote);
});

it('시장가 상한 누락·초과는 예약하지 않는다', async () => {
  const { service } = setup();
  await service.createListing(seller, { inventoryItemId: card.id, price: '10000000' }, context());
  await expect(service.quoteMarketPurchase(buyer, { cardVariantId: card.cardVariantId } as never, context())).rejects.toThrow();
  expect(await service.quoteMarketPurchase(buyer, { cardVariantId: card.cardVariantId, maxPrice: '9999999' }, context())).toBeNull();
  expect(await service.listListings()).toHaveLength(1);
});

it('검증 컨텍스트가 없거나 Agent·정책이 유효하지 않으면 신규 예약을 거부한다', async () => {
  const noContext = createTradingService({ store: createMockTradingStore() });
  const listing = await noContext.createListing(seller, { inventoryItemId: card.id, price: '10000000' }, context());
  await expect(noContext.quoteFixedPurchase(buyer, { listingId: listing.id, maxPrice: '10000000' }, context())).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  for (const change of [
    { enabled: false }, { validUntil: '2020-01-01T00:00:00.000Z' }, { agentId: other.agentId }, { allowedCardVariantIds: [] }, { maxPerTrade: '1' }, { totalBudget: '1' },
  ]) {
    const { service, setPolicy } = setup();
    setPolicy(change);
    const row = await service.createListing(seller, { inventoryItemId: card.id, price: '10000000' }, context());
    await expect(service.quoteFixedPurchase(buyer, { listingId: row.id, maxPrice: '10000000' }, context())).rejects.toMatchObject({ code: ['maxPerTrade', 'totalBudget'].some(key => key in change) ? 'BUDGET_EXCEEDED' : 'POLICY_VIOLATION' });
    expect(await service.listListings()).toHaveLength(1);
  }
});

it('Agent 중단 시 미제출 예약은 유지하고 주문을 중지하며 재개 시 정책을 다시 확인한다', async () => {
  const { service, setOnline } = setup();
  await service.createListing(seller, { inventoryItemId: card.id, price: '10000000' }, context());
  const order = await service.createBuyOrder(buyer, { cardVariantId: card.cardVariantId, maxPrice: '20000000', expiresAt: '2098-01-01T00:00:00.000Z' }, context());
  const quote = (await service.matchBuyOrder(buyer, order.id, { idempotencyKey: randomUUID() }))!;
  setOnline(false);
  expect(await service.pauseAgentOrders(buyer)).toMatchObject([{ id: order.id, status: 'PAUSED' }]);
  expect(await service.getMatch(buyer, quote.id)).toMatchObject({ status: 'RESERVED', expiresAt: quote.expiresAt });
  await expect(service.resumeBuyOrder(buyer, order.id)).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  setOnline(true);
  expect(await service.resumeBuyOrder(buyer, order.id)).toMatchObject({ status: 'MATCH_PENDING' });
  await service.releaseQuote(buyer, quote.id);
  setOnline(false);
  await expect(service.matchBuyOrder(buyer, order.id, { idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  await expect(service.pauseBuyOrder(other, order.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('Agent 중단 후에도 제출된 결제를 보존하고 정산 복구·인가된 거래 조회를 허용한다', async () => {
  const { service, records, setOnline } = setup();
  await service.createListing(seller, { inventoryItemId: card.id, price: '10000000' }, context());
  const order = await service.createBuyOrder(buyer, { cardVariantId: card.cardVariantId, maxPrice: '10000000', expiresAt: '2098-01-01T00:00:00.000Z' }, context());
  const quote = (await service.matchBuyOrder(buyer, order.id, { idempotencyKey: randomUUID() }))!;
  const attempt = randomUUID();
  await service.beginPayment(quote.id, attempt);
  setOnline(false);
  expect(await service.pauseAgentOrders(buyer)).toEqual([]);
  expect(await service.getMatch(buyer, quote.id)).toMatchObject({ status: 'PAYMENT_PENDING' });
  records.set(attempt, { paymentAttemptId: attempt, matchQuoteId: quote.id, amount: quote.amount, currency: 'USDC', status: 'SETTLED' });
  const trade = await service.finalizeTrade(quote.id, attempt);
  expect(await service.listTrades(buyer)).toEqual([trade]);
  expect(await service.getTrade(seller, trade.id)).toEqual(trade);
  await expect(service.getTrade(other, trade.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(service.getMatch(other, quote.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
});
