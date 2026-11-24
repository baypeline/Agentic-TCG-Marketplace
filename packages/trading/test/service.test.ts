import { allowExecution } from './helpers.js';
import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buyOrderSchema, matchQuoteSchema, tradeSchema } from '@tcg/contracts';
import {
  createMockTradingStore, createTradingService, demoInventory, demoSellerId, type PaymentRecord, type TradingStore,
} from '../src/index.js';

const seller = { userId: demoSellerId };
const buyer = { userId: randomUUID(), agentId: randomUUID() };
const other = { userId: randomUUID(), agentId: randomUUID() };
const card = demoInventory[0]!;
const secondCard = demoInventory[1]!;
const price = '10000000';

function setup(store: TradingStore = createMockTradingStore()) {
  let clock = Date.parse('2026-11-24T00:00:00Z');
  const records = new Map<string, PaymentRecord>();
  const service = createTradingService({ executionContext: allowExecution,
    store, quoteTtlMs: 1000, now: () => new Date(clock),
    payment: { async getPaymentRecord(id) { return records.get(id) ?? null; } },
  });
  return { service, records, advance(ms: number) { clock += ms; } };
}

async function list(service: ReturnType<typeof createTradingService>, inventoryItemId = card.id, amount = price) {
  return service.createListing(seller, { inventoryItemId, price: amount }, { idempotencyKey: randomUUID() });
}

async function quoteFixed(service: ReturnType<typeof createTradingService>) {
  const listing = await list(service);
  return service.quoteFixedPurchase(buyer, { listingId: listing.id, maxPrice: price }, { idempotencyKey: randomUUID() });
}

function evidence(quote: { id: string; amount: string }, paymentAttemptId: string, status: PaymentRecord['status']): PaymentRecord {
  return { paymentAttemptId, matchQuoteId: quote.id, amount: quote.amount, currency: 'USDC', status };
}

describe('trading service', () => {
  it('keeps a bid waiting, matches a cheaper card, and settles the trade once', async () => {
    const { service, records } = setup();
    expect(await service.listInventory(seller)).toHaveLength(6);
    await list(service);
    const order = buyOrderSchema.parse(await service.createBuyOrder(buyer, {
      cardVariantId: card.cardVariantId, maxPrice: '9000000', expiresAt: '2026-11-24T00:01:00Z',
    }, { idempotencyKey: randomUUID() }));
    expect(await service.matchBuyOrder(buyer, order.id)).toBeNull();
    expect(await service.listBuyOrders(buyer)).toEqual([order]);
    const cheaper = await list(service, secondCard.id, '8000000');
    const quote = matchQuoteSchema.parse(await service.matchBuyOrder(buyer, order.id));
    expect(quote).toMatchObject({ listingId: cheaper.id, buyOrderId: order.id, status: 'RESERVED' });
    expect(await service.matchBuyOrder(buyer, order.id)).toEqual(quote);

    const attempt = randomUUID();
    await service.beginPayment(quote.id, attempt);
    await expect(service.finalizeTrade(quote.id, attempt)).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
    records.set(attempt, { ...evidence(quote, attempt, 'SETTLED'), amount: '1' });
    await expect(service.finalizeTrade(quote.id, attempt)).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
    expect(await service.listInventory(buyer)).toEqual([]);
    records.set(attempt, evidence(quote, attempt, 'SETTLED'));
    const [first, second] = await Promise.all([
      service.finalizeTrade(quote.id, attempt), service.finalizeTrade(quote.id, attempt),
    ]);
    expect(tradeSchema.parse(first)).toEqual(second);
    expect(await service.listInventory(buyer)).toEqual([{ ...secondCard, ownerId: buyer.userId }]);
    expect(await service.listBuyOrders(buyer)).toMatchObject([{ status: 'FILLED' }]);
    records.delete(attempt);
    expect(await service.finalizeTrade(quote.id, attempt)).toEqual(first);
    await expect(service.finalizeTrade(quote.id, randomUUID())).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
  });

  it('sorts numerically and breaks ties by time and then ID', async () => {
    const third = { ...card, id: randomUUID() };
    const fourth = { ...card, id: randomUUID() };
    const { service, advance } = setup(createMockTradingStore([card, secondCard, third, fourth]));
    const expensive = await list(service, card.id, '100');
    const early = await list(service, secondCard.id, '9');
    advance(1);
    const ties = await Promise.all([list(service, third.id, '9'), list(service, fourth.id, '9')]);
    expect((await service.listListings()).map(item => item.id)).toEqual([
      early.id, ...ties.map(item => item.id).sort(), expensive.id,
    ]);
    expect(await service.findLowestListing(card.cardVariantId)).toEqual(early);
    expect(await service.quoteMarketPurchase(buyer, { cardVariantId: card.cardVariantId, maxPrice: '8' }, { idempotencyKey: randomUUID() })).toBeNull();
    expect(await service.quoteMarketPurchase(buyer, { cardVariantId: card.cardVariantId, maxPrice: '9' }, { idempotencyKey: randomUUID() }))
      .toMatchObject({ listingId: early.id });
  });

  it('only permits one listing and reservation in concurrent calls', async () => {
    const { service } = setup();
    const listings = await Promise.allSettled([list(service), list(service)]);
    expect(listings.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const [listing] = await service.listListings();
    const input = { listingId: listing!.id, maxPrice: price };
    await expect(service.quoteFixedPurchase(buyer, { ...input, maxPrice: '9' }, { idempotencyKey: randomUUID() })).rejects.toMatchObject({ code: 'PRICE_LIMIT_EXCEEDED' });
    const quotes = await Promise.allSettled([service.quoteFixedPurchase(buyer, input, { idempotencyKey: randomUUID() }), service.quoteFixedPurchase(other, input, { idempotencyKey: randomUUID() })]);
    expect(quotes.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    await expect(service.cancelListing(seller, listing!.id)).rejects.toMatchObject({ code: 'LISTING_UNAVAILABLE' });
  });

  it('blocks cancelled listings and allows the owner to relist', async () => {
    const { service } = setup();
    const listing = await list(service);
    await expect(service.cancelListing(buyer, listing.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(await service.cancelListing(seller, listing.id)).toMatchObject({ status: 'CANCELLED' });
    await expect(service.quoteFixedPurchase(buyer, { listingId: listing.id, maxPrice: price }, { idempotencyKey: randomUUID() }))
      .rejects.toMatchObject({ code: 'LISTING_UNAVAILABLE' });
    expect((await list(service)).id).not.toBe(listing.id);
  });

  it('releases expired quotes and protects pending or unknown payments past TTL', async () => {
    const { service, advance, records } = setup();
    const quote = await quoteFixed(service);
    await expect(service.releaseQuote(other, quote.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    advance(1000);
    expect(await service.expireReservations()).toBe(1);
    expect(await service.releaseQuote(buyer, quote.id)).toMatchObject({ status: 'RELEASED' });
    const next = await service.quoteFixedPurchase(buyer, { listingId: quote.listingId, maxPrice: price }, { idempotencyKey: randomUUID() });
    const attempt = randomUUID();
    await service.beginPayment(next.id, attempt);
    const secondListing = await list(service, secondCard.id);
    const separateQuote = await service.quoteFixedPurchase(other, { listingId: secondListing.id, maxPrice: price }, { idempotencyKey: randomUUID() });
    await expect(service.beginPayment(separateQuote.id, attempt)).rejects.toMatchObject({ code: 'PAYMENT_REQUIRED' });
    advance(1000);
    expect(await service.expireReservations()).toBe(1);
    await expect(service.releaseQuote(buyer, next.id)).rejects.toMatchObject({ code: 'QUOTE_EXPIRED' });
    await expect(list(service)).rejects.toMatchObject({ code: 'INVENTORY_CONFLICT' });
    records.set(attempt, evidence(next, attempt, 'UNKNOWN'));
    await expect(service.releaseFailedPayment(next.id, attempt)).rejects.toMatchObject({ code: 'PAYMENT_UNKNOWN' });
    records.set(attempt, evidence(next, attempt, 'FAILED'));
    expect(await service.releaseFailedPayment(next.id, attempt)).toMatchObject({ status: 'RELEASED' });
    expect(await service.findLowestListing(card.cardVariantId)).not.toBeNull();
  });

  it('reopens released orders for retry and expires orders at their deadline', async () => {
    const { service, advance } = setup();
    await list(service);
    const order = await service.createBuyOrder(buyer, {
      cardVariantId: card.cardVariantId, maxPrice: price, expiresAt: '2026-11-24T00:00:02Z',
    }, { idempotencyKey: randomUUID() });
    const quote = (await service.matchBuyOrder(buyer, order.id))!;
    await service.releaseQuote(buyer, quote.id);
    expect(await service.listBuyOrders(buyer)).toMatchObject([{ status: 'ACTIVE' }]);
    expect((await service.matchBuyOrder(buyer, order.id))?.id).not.toBe(quote.id);
    advance(2000);
    expect(await service.listBuyOrders(buyer)).toMatchObject([{ status: 'EXPIRED' }]);
    await expect(service.matchBuyOrder(buyer, order.id)).rejects.toMatchObject({ code: 'ORDER_NOT_ACTIVE' });
  });

  it('can retry after a transactional write failure following successful settlement', async () => {
    const base = createMockTradingStore();
    let fail = true;
    const { service, records } = setup({
      transaction: work => base.transaction(tx => work({
        ...tx, trades: {
          ...tx.trades,
          async insert(row) {
            if (fail) throw new Error('simulated DB write failure');
            return tx.trades.insert(row);
          },
        },
      })),
    });
    const quote = await quoteFixed(service);
    const attempt = randomUUID();
    await service.beginPayment(quote.id, attempt);
    records.set(attempt, evidence(quote, attempt, 'SETTLED'));
    await expect(service.finalizeTrade(quote.id, attempt)).rejects.toThrow('simulated DB write failure');
    expect(await service.listInventory(buyer)).toEqual([]);
    expect(await service.listInventory(seller)).toContainEqual({ ...card, status: 'RESERVED' });
    fail = false;
    expect(await service.finalizeTrade(quote.id, attempt)).toMatchObject({ status: 'COMPLETED' });
  });
});
