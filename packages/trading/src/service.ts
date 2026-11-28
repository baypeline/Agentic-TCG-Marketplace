import type { Currency } from '@tcg/contracts/payment-profile';
import { createRequestExecutor } from './requests.js';
import { randomUUID } from 'node:crypto';
import {
  AppError, type ErrorCode, type Listing, type MutationContext, type TradingExecutionContextReader, type ValuationService,
  tradingIdSchema as uuid, tradingUserSchema as userSchema, tradingBuyerSchema as buyerSchema,
  createListingInputSchema as listingInputSchema, createBuyOrderInputSchema as orderInputSchema,
  fixedPurchaseInputSchema as fixedInputSchema, marketPurchaseInputSchema as marketInputSchema,
  listingQuerySchema, mutationContextSchema,
} from '@tcg/contracts';
import { assertTradingExecution } from './execution.js';
export { createListingInputSchema as listingInputSchema, createBuyOrderInputSchema as orderInputSchema,
  fixedPurchaseInputSchema as fixedInputSchema, marketPurchaseInputSchema as marketInputSchema,
  listingQuerySchema, tradingUserSchema as userSchema, tradingBuyerSchema as buyerSchema } from '@tcg/contracts';
import { z } from 'zod';
import { listingDto, orderDto, quoteDto as storedQuoteDto, tradeDto, type TradingStore, type TradingTransaction } from './store.js';

type Buyer = z.infer<typeof buyerSchema>;
type QuoteRow = NonNullable<Awaited<ReturnType<TradingTransaction['quotes']['get']>>>;
type ListingRow = NonNullable<Awaited<ReturnType<TradingTransaction['listings']['get']>>>;

export interface PaymentRecord {
  paymentAttemptId: string;
  matchQuoteId: string;
  amount: string;
  currency: Currency;
  status: 'REQUIRED' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'SETTLED';
}

export interface PaymentEvidenceReader {
  getPaymentRecord(paymentAttemptId: string): Promise<PaymentRecord | null>;
}

export interface TradingOptions {
  assertInventoryMutation?: (inventoryItemId: string) => Promise<void>;
  decorateListing?: (listing: import('@tcg/contracts').Listing) => Promise<import('@tcg/contracts').Listing>;
  currency?: Currency;
  store: TradingStore;
  payment?: PaymentEvidenceReader;
  quoteTtlMs?: number;
  now?: () => Date;
  executionContext?: TradingExecutionContextReader;
  valuationService?: ValuationService;
  executionInTransaction?: (tx: TradingTransaction, buyer: Buyer, time: Date, policyId?: string | null) => ReturnType<TradingExecutionContextReader['getExecutionContext']>;
}

function conflict(code: ErrorCode, message: string): never {
  throw new AppError(code, message, 409);
}

function authorize(allowed: boolean) {
  if (!allowed) throw new AppError('FORBIDDEN', '해당 거래에 접근할 수 없습니다.', 403);
}

function compareListings(a: ListingRow, b: ListingRow) {
  const left = BigInt(a.price);
  const right = BigInt(b.price);
  if (left !== right) return left < right ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id);
}

async function getQuote(tx: TradingTransaction, id: string) {
  const quote = await tx.quotes.get(id);
  if (!quote) throw new AppError('QUOTE_EXPIRED', '예약을 찾을 수 없습니다.', 404);
  return quote;
}

async function reservedListing(tx: TradingTransaction, quote: QuoteRow) {
  const listing = await tx.listings.get(quote.listingId);
  if (!listing || listing.status !== 'RESERVED' || listing.inventoryItemId !== quote.inventoryItemId) {
    conflict('LISTING_UNAVAILABLE', '예약된 매물을 찾을 수 없습니다.');
  }
  return listing;
}

async function updateInventory(tx: TradingTransaction, listing: ListingRow, status: 'LISTED' | 'AVAILABLE', ownerId = listing.sellerId) {
  const item = await tx.inventory.get(listing.inventoryItemId);
  if (!item || item.status !== 'RESERVED' || item.ownerId !== listing.sellerId) {
    conflict('INVENTORY_CONFLICT', '카드 예약 상태가 변경되었습니다.');
  }
  await tx.inventory.replace({ ...item, status, ownerId }, { status: 'RESERVED', ownerId: listing.sellerId });
}

async function resolveOrder(tx: TradingTransaction, quote: QuoteRow, now: Date, completed: boolean) {
  if (!quote.buyOrderId) return;
  const order = await tx.orders.get(quote.buyOrderId);
  if (!order || !['MATCH_PENDING', 'PAUSED', 'EXPIRED'].includes(order.status)) conflict('ORDER_NOT_ACTIVE', '주문 상태가 변경되었습니다.');
  const status = completed ? 'FILLED' : order.expiresAt <= now ? 'EXPIRED' : order.status === 'PAUSED' ? 'PAUSED' : 'ACTIVE';
  await tx.orders.replace({ ...order, status }, { status: order.status });
}

async function release(tx: TradingTransaction, quote: QuoteRow, now: Date, currency: Currency = 'USDC') {
  const listing = await reservedListing(tx, quote);
  const released = { ...quote, status: 'RELEASED' as const };
  await tx.quotes.replace(released, { status: quote.status });
  await tx.listings.replace({ ...listing, status: 'ACTIVE' }, { status: 'RESERVED' });
  await updateInventory(tx, listing, 'LISTED');
  await resolveOrder(tx, quote, now, false);
  return storedQuoteDto(released, currency);
}

export function createTradingService({ store, payment, currency = 'USDC', assertInventoryMutation, decorateListing, quoteTtlMs = 120_000, now = () => new Date(), executionContext, valuationService, executionInTransaction }: TradingOptions) {
  z.number().int().positive().max(86_400_000).parse(quoteTtlMs);
  const run = <T>(work: (tx: TradingTransaction, time: Date) => Promise<T>) =>
    store.transaction(tx => work(tx, now()));

  const quoteDto = (row: QuoteRow) => storedQuoteDto(row, currency);
  const mutate = createRequestExecutor(store, now);
  const contextFor = (tx: TradingTransaction, time: Date, policyId?: string | null) => executionInTransaction ? { getExecutionContext: (buyer: Buyer) => executionInTransaction(tx, buyer, time, policyId) } : executionContext;

  function expireReservations() {
    return run(async (tx, time) => {
      const expired = await tx.quotes.find({ status: 'RESERVED', expiresAt: { lte: time } });
      for (const quote of expired) await release(tx, quote, time, currency);
      for (const status of ['ACTIVE', 'PAUSED'] as const) {
        for (const order of await tx.orders.find({ status, expiresAt: { lte: time } })) {
          await tx.orders.replace({ ...order, status: 'EXPIRED' }, { status });
        }
      }
      return expired.length;
    });
  }

  async function bestListing(tx: TradingTransaction, cardVariantId: string, buyerId?: string) {
    return (await tx.listings.find({ cardVariantId, status: 'ACTIVE' }))
      .filter(listing => listing.sellerId !== buyerId)
      .sort(compareListings)[0];
  }

  async function reserve(tx: TradingTransaction, time: Date, listing: ListingRow, buyer: Buyer, buyOrderId: string | null = null) {
    authorize(listing.sellerId !== buyer.userId);
    const policy = await assertTradingExecution({ buyer, cardVariantId: listing.cardVariantId, amount: listing.price, time, executionContext: contextFor(tx, time), valuationService });
    const item = await tx.inventory.get(listing.inventoryItemId);
    if (!item || item.status !== 'LISTED' || item.ownerId !== listing.sellerId || item.cardVariantId !== listing.cardVariantId) {
      conflict('INVENTORY_CONFLICT', '예약 가능한 재고가 없습니다.');
    }
    await tx.listings.replace({ ...listing, status: 'RESERVED' }, { status: 'ACTIVE' });
    await tx.inventory.replace({ ...item, status: 'RESERVED' }, { status: 'LISTED', ownerId: listing.sellerId });
    const quote: QuoteRow = {
      id: randomUUID(), listingId: listing.id, inventoryItemId: item.id, buyerAgentId: buyer.agentId,
      buyerId: buyer.userId, policyId: policy.id, buyOrderId, paymentAttemptId: null, amount: listing.price,
      status: 'RESERVED', expiresAt: new Date(time.getTime() + quoteTtlMs),
    };
    await tx.quotes.insert(quote);
    return quoteDto(quote);
  }

  async function readEvidence(quoteId: string, attemptId: string, statuses: PaymentRecord['status'][]) {
    const record = await payment?.getPaymentRecord(attemptId);
    if (!record || record.paymentAttemptId !== attemptId || record.matchQuoteId !== quoteId || record.currency !== currency) {
      conflict('PAYMENT_REQUIRED', '예약과 연결된 결제 증빙이 필요합니다.');
    }
    if (!statuses.includes(record.status)) {
      throw new AppError('PAYMENT_UNKNOWN', '결제의 최종 상태를 확인할 수 없습니다.', 409, true);
    }
    return record;
  }

  function requirePaymentBinding(quote: QuoteRow, record: PaymentRecord) {
    if (quote.paymentAttemptId !== record.paymentAttemptId || quote.amount !== record.amount) {
      conflict('PAYMENT_REQUIRED', '결제 증빙이 예약의 결제 시도 또는 금액과 일치하지 않습니다.');
    }
  }

  async function changeOrderState(tx: TradingTransaction, time: Date, buyer: Buyer, id: string, paused: boolean) {
    let order = await tx.orders.get(id);
    if (!order) throw new AppError('ORDER_NOT_ACTIVE', '주문을 찾을 수 없습니다.', 404);
    authorize(order.buyerId === buyer.userId && order.agentId === buyer.agentId);
    if (paused && order.status === 'MATCH_PENDING') {
      const [quote] = (await tx.quotes.find({ buyOrderId: id })).filter(row => row.status === 'RESERVED');
      if (!quote) conflict('ORDER_NOT_ACTIVE', '제출된 결제의 상태 확인과 복구는 계속 진행해야 합니다.');
      // 미제출 예약은 보존하고 주문만 중지한다. TTL은 변경하지 않는다.
    }
    if (order.status !== 'ACTIVE' && order.status !== 'PAUSED' && order.status !== 'EXPIRED' && !(paused && order.status === 'MATCH_PENDING')) {
      conflict('ORDER_NOT_ACTIVE', '변경 가능한 대기 주문이 아닙니다.');
    }
    const held = (await tx.quotes.find({ buyOrderId: id })).some(quote => quote.status === 'RESERVED');
    const status = order.expiresAt <= time ? 'EXPIRED' as const : paused ? 'PAUSED' as const : held ? 'MATCH_PENDING' as const : 'ACTIVE' as const;
    if (!paused && status !== 'EXPIRED') {
      await assertTradingExecution({ buyer, cardVariantId: order.cardVariantId, amount: '0', time, executionContext: contextFor(tx, time), checkDiscount: false });
    }
    const updated = { ...order, status };
    await tx.orders.replace(updated, { status: order.status });
    return orderDto(updated);
  }

  return {
    async getListing(rawId: string) {
      const id = uuid.parse(rawId);
      await expireReservations();
      return run(async tx => {
        const listing = await tx.listings.get(id);
        if (!listing) throw new AppError('LISTING_UNAVAILABLE', '매물을 찾을 수 없습니다.', 404);
        return listingDto(listing);
      });
    },
    async listTrades(auth: { userId: string }) {
      const { userId } = userSchema.parse(auth);
      return run(async tx => {
        const rows = [...await tx.trades.find({ buyerId: userId }), ...await tx.trades.find({ sellerId: userId })];
        return [...new Map(rows.map(row => [row.id, row])).values()]
          .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime() || a.id.localeCompare(b.id)).map(tradeDto);
      });
    },
    async listMatches(auth: Buyer) {
      const buyer = buyerSchema.parse(auth);
      const ids = await run(async tx => (await tx.quotes.find({ buyerId: buyer.userId, buyerAgentId: buyer.agentId })).map(row => row.id));
      return Promise.all(ids.map(id => this.getMatch(buyer, id)));
    },
    async sellerProceeds(auth: { userId: string }) {
      const { userId } = userSchema.parse(auth);
      return run(async tx => { const rows = await tx.trades.find({ sellerId: userId }); return { amount: rows.reduce((sum, row) => sum + BigInt(row.price), 0n).toString(), currency, tradeCount: rows.length, withdrawable: false as const }; });
    },
    async getTrade(auth: { userId: string }, rawId: string) {
      const { userId } = userSchema.parse(auth);
      const id = uuid.parse(rawId);
      return run(async tx => {
        const trade = await tx.trades.get(id);
        if (!trade) throw new AppError('TRADE_NOT_FOUND', '거래를 찾을 수 없습니다.', 404);
        authorize(trade.buyerId === userId || trade.sellerId === userId);
        return tradeDto(trade);
      });
    },
    async getMatch(auth: Buyer, rawId: string) {
      const buyer = buyerSchema.parse(auth);
      const id = uuid.parse(rawId);
      await expireReservations();
      return run(async (tx, time) => {
        const quote = await getQuote(tx, id);
        authorize(quote.buyerId === buyer.userId && quote.buyerAgentId === buyer.agentId);
        const holdReasons: string[] = [];
        if (quote.status === 'RESERVED') {
          const listing = await reservedListing(tx, quote);
          if (quote.buyOrderId && (await tx.orders.get(quote.buyOrderId))?.status === 'PAUSED') holdReasons.push('주문이 일시 중지됐습니다.');
          try { await assertTradingExecution({ buyer, cardVariantId: listing.cardVariantId, amount: quote.amount, time, executionContext: contextFor(tx, time, quote.policyId), valuationService }); }
          catch (error) { if (error instanceof AppError) holdReasons.push(error.message); else throw error; }
        }
        return { ...quoteDto(quote), holdReasons, remainingMs: Math.max(0, quote.expiresAt.getTime() - time.getTime()) };
      });
    },
    async pauseBuyOrder(auth: Buyer, rawId: string) {
      const buyer = buyerSchema.parse(auth);
      const id = uuid.parse(rawId);
      return run((tx, time) => changeOrderState(tx, time, buyer, id, true));
    },
    async resumeBuyOrder(auth: Buyer, rawId: string) {
      const buyer = buyerSchema.parse(auth);
      const id = uuid.parse(rawId);
      await expireReservations();
      return run((tx, time) => changeOrderState(tx, time, buyer, id, false));
    },
    async pauseAgentOrders(auth: Buyer) {
      const buyer = buyerSchema.parse(auth);
      return run(async (tx, time) => {
        const orders = await tx.orders.find({ buyerId: buyer.userId, agentId: buyer.agentId });
        const paused = [];
        for (const order of orders) {
          if (order.status === 'ACTIVE' || order.status === 'PAUSED' || (order.status === 'MATCH_PENDING' &&
            (await tx.quotes.find({ buyOrderId: order.id })).some(quote => quote.status === 'RESERVED'))) {
            paused.push(await changeOrderState(tx, time, buyer, order.id, true));
          }
        }
        return paused;
      });
    },
    async listInventory(auth: { userId: string }) {
      const { userId } = userSchema.parse(auth);
      await expireReservations();
      return run(async tx => (await tx.inventory.find({ ownerId: userId })).map(item => ({ ...item })));
    },
    async createListing(auth: { userId: string }, input: z.input<typeof listingInputSchema>, context: MutationContext) {
      const { userId } = userSchema.parse(auth);
      const { inventoryItemId, price } = listingInputSchema.parse(input);
      await assertInventoryMutation?.(inventoryItemId);
      return mutate({ userId }, 'createListing', { inventoryItemId, price }, context, async (tx, time) => {
        const item = await tx.inventory.get(inventoryItemId);
        if (!item) throw new AppError('INVENTORY_CONFLICT', '카드를 찾을 수 없습니다.', 404);
        authorize(item.ownerId === userId);
        if (item.status !== 'AVAILABLE') conflict('INVENTORY_CONFLICT', '등록 가능한 카드가 아닙니다.');
        await tx.inventory.replace({ ...item, status: 'LISTED' }, { status: 'AVAILABLE', ownerId: userId });
        const listing = { id: randomUUID(), inventoryItemId, cardVariantId: item.cardVariantId, sellerId: userId, price, status: 'ACTIVE' as const, createdAt: time };
        await tx.listings.insert(listing);
        return listingDto(listing);
      });
    },
    async listListings(input: z.input<typeof listingQuerySchema> = {}) {
      const query = listingQuerySchema.parse(input);
      await expireReservations();
      const rows = await run(async tx => (await tx.listings.find({
        status: 'ACTIVE', ...(query.cardVariantId ? { cardVariantId: query.cardVariantId } : {}),
      })).filter(row => query.maxPrice === undefined || BigInt(row.price) <= BigInt(query.maxPrice)).sort(compareListings).map(listingDto));
      return decorateListing ? Promise.all(rows.map(decorateListing)) : rows;
    },
    async cancelListing(auth: { userId: string }, rawId: string) {
      const { userId } = userSchema.parse(auth);
      const id = uuid.parse(rawId);
      await expireReservations();
      return run(async tx => {
        const listing = await tx.listings.get(id);
        if (!listing) throw new AppError('LISTING_UNAVAILABLE', '매물을 찾을 수 없습니다.', 404);
        authorize(listing.sellerId === userId);
        await assertInventoryMutation?.(listing.inventoryItemId);
        if (listing.status === 'CANCELLED') return listingDto(listing);
        if (listing.status !== 'ACTIVE') conflict('LISTING_UNAVAILABLE', '취소 가능한 매물이 아닙니다.');
        const item = await tx.inventory.get(listing.inventoryItemId);
        if (!item || item.status !== 'LISTED' || item.ownerId !== userId) {
          conflict('INVENTORY_CONFLICT', '매물의 재고 상태가 변경되었습니다.');
        }
        const cancelled = { ...listing, status: 'CANCELLED' as const };
        await tx.listings.replace(cancelled, { status: 'ACTIVE' });
        await tx.inventory.replace({ ...item, status: 'AVAILABLE' }, { status: 'LISTED', ownerId: userId });
        return listingDto(cancelled);
      });
    },
    async createBuyOrder(auth: Buyer, input: z.input<typeof orderInputSchema>, context: MutationContext) {
      const buyer = buyerSchema.parse(auth);
      const { cardVariantId, maxPrice, expiresAt } = orderInputSchema.parse(input);
      const expiry = new Date(expiresAt);
      return mutate(buyer, 'createBuyOrder', { cardVariantId, maxPrice, expiresAt }, context, async (tx, time) => {
        if (expiry <= time) throw new AppError('VALIDATION_ERROR', '주문 만료 시각은 현재보다 뒤여야 합니다.');
        if (!await tx.hasCard(cardVariantId)) throw new AppError('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.', 404);
        const order = {
          id: randomUUID(), buyerId: buyer.userId, agentId: buyer.agentId, cardVariantId, maxPrice,
          status: 'ACTIVE' as const, createdAt: time, expiresAt: expiry,
        };
        await tx.orders.insert(order);
        return orderDto(order);
      });
    },
    async listBuyOrders(auth: Buyer) {
      const buyer = buyerSchema.parse(auth);
      await expireReservations();
      return run(async (tx, time) => (await tx.orders.find({ buyerId: buyer.userId, agentId: buyer.agentId }))
        .map(order => orderDto(
          (order.status === 'ACTIVE' || order.status === 'PAUSED') && order.expiresAt <= time
            ? { ...order, status: 'EXPIRED' } : order,
        )));
    },
    async cancelBuyOrder(auth: Buyer, rawId: string) {
      const buyer = buyerSchema.parse(auth);
      const id = uuid.parse(rawId);
      await expireReservations();
      return run(async (tx, time) => {
        const order = await tx.orders.get(id);
        if (!order) throw new AppError('ORDER_NOT_ACTIVE', '주문을 찾을 수 없습니다.', 404);
        authorize(order.buyerId === buyer.userId && order.agentId === buyer.agentId);
        if (order.status === 'CANCELLED' || order.status === 'EXPIRED') return orderDto(order);
        if (order.status !== 'ACTIVE' && order.status !== 'PAUSED') conflict('ORDER_NOT_ACTIVE', '취소 가능한 주문이 아닙니다.');
        for (const quote of await tx.quotes.find({ buyOrderId: id, status: 'RESERVED' })) await release(tx, quote, time, currency);
        const updated = { ...order, status: order.expiresAt <= time ? 'EXPIRED' as const : 'CANCELLED' as const };
        await tx.orders.replace(updated, { status: order.status });
        return orderDto(updated);
      });
    },
    async findLowestListing(rawVariant: string): Promise<Listing | null> {
      const cardVariantId = uuid.parse(rawVariant);
      await expireReservations();
      return run(async tx => {
        const listing = await bestListing(tx, cardVariantId);
        return listing ? listingDto(listing) : null;
      });
    },
    async quoteFixedPurchase(auth: Buyer, input: z.input<typeof fixedInputSchema>, context: MutationContext) {
      const buyer = buyerSchema.parse(auth);
      const { listingId, maxPrice } = fixedInputSchema.parse(input);
      await expireReservations();
      return mutate(buyer, 'quoteFixedPurchase', { listingId, maxPrice }, context, async (tx, time) => {
        const listing = await tx.listings.get(listingId);
        if (!listing || listing.status !== 'ACTIVE') conflict('LISTING_UNAVAILABLE', '구매 가능한 매물이 아닙니다.');
        if (BigInt(listing.price) > BigInt(maxPrice)) conflict('PRICE_LIMIT_EXCEEDED', '매물 가격이 구매 상한을 초과합니다.');
        return reserve(tx, time, listing, buyer);
      });
    },
    async quoteMarketPurchase(auth: Buyer, input: z.input<typeof marketInputSchema>, context: MutationContext) {
      const buyer = buyerSchema.parse(auth);
      const { cardVariantId, maxPrice } = marketInputSchema.parse(input);
      await expireReservations();
      return mutate(buyer, 'quoteMarketPurchase', { cardVariantId, maxPrice }, context, async (tx, time) => {
        const listing = await bestListing(tx, cardVariantId, buyer.userId);
        if (!listing || BigInt(listing.price) > BigInt(maxPrice)) return null;
        return reserve(tx, time, listing, buyer);
      });
    },
    async matchBuyOrder(auth: Buyer, rawId: string, context: MutationContext) {
      const buyer = buyerSchema.parse(auth);
      const id = uuid.parse(rawId);
      await expireReservations();
      return mutate(buyer, 'matchBuyOrder', { id }, context, async (tx, time) => {
        const order = await tx.orders.get(id);
        if (!order) throw new AppError('ORDER_NOT_ACTIVE', '주문을 찾을 수 없습니다.', 404);
        authorize(order.buyerId === buyer.userId && order.agentId === buyer.agentId);
        if (order.status === 'MATCH_PENDING') {
          const current = (await tx.quotes.find({ buyOrderId: id })).find(quote =>
            ['RESERVED', 'PAYMENT_PENDING', 'SETTLED', 'RECONCILING'].includes(quote.status)
          );
          if (current) return quoteDto(current);
        }
        if (order.status !== 'ACTIVE' || order.expiresAt <= time) conflict('ORDER_NOT_ACTIVE', '매칭 가능한 주문이 아닙니다.');
        await assertTradingExecution({ buyer, cardVariantId: order.cardVariantId, amount: '0', time, executionContext: contextFor(tx, time), checkDiscount: false });
        const listing = await bestListing(tx, order.cardVariantId, buyer.userId);
        if (!listing || BigInt(listing.price) > BigInt(order.maxPrice)) return null;
        await tx.orders.replace({ ...order, status: 'MATCH_PENDING' }, { status: 'ACTIVE' });
        return reserve(tx, time, listing, buyer, order.id);
      });
    },
    async releaseQuote(auth: Buyer, rawId: string) {
      const buyer = buyerSchema.parse(auth);
      const id = uuid.parse(rawId);
      return run(async (tx, time) => {
        const quote = await getQuote(tx, id);
        authorize(quote.buyerId === buyer.userId && quote.buyerAgentId === buyer.agentId);
        if (quote.status === 'RELEASED') return quoteDto(quote);
        if (quote.status !== 'RESERVED') conflict('QUOTE_EXPIRED', '해제 가능한 예약이 아닙니다.');
        return release(tx, quote, time, currency);
      });
    },
    expireReservations,
    // 서버 내부 Payment 호출 전용. 결제 요청은 이 상태 전이가 끝난 뒤에만 시작한다.
    async beginPayment(rawQuoteId: string, rawAttemptId: string) {
      const id = uuid.parse(rawQuoteId);
      const attemptId = uuid.parse(rawAttemptId);
      await expireReservations();
      return run(async (tx, time) => {
        const quote = await getQuote(tx, id);
        if (quote.status === 'PAYMENT_PENDING' && quote.paymentAttemptId === attemptId) return quoteDto(quote);
        if (quote.status !== 'RESERVED' || quote.expiresAt <= time) conflict('QUOTE_EXPIRED', '결제를 시작할 수 없는 예약입니다.');
        if ((await tx.quotes.find({ paymentAttemptId: attemptId })).length) {
          conflict('PAYMENT_REQUIRED', '이미 연결된 결제 시도입니다.');
        }
        const pending = { ...quote, status: 'PAYMENT_PENDING' as const, paymentAttemptId: attemptId };
        await tx.quotes.replace(pending, { status: 'RESERVED', paymentAttemptId: null });
        return quoteDto(pending);
      });
    },
    async releaseFailedPayment(rawQuoteId: string, rawAttemptId: string) {
      const id = uuid.parse(rawQuoteId);
      const attemptId = uuid.parse(rawAttemptId);
      const record = await readEvidence(id, attemptId, ['FAILED']);
      return run(async (tx, time) => {
        const quote = await getQuote(tx, id);
        requirePaymentBinding(quote, record);
        if (quote.status === 'RELEASED') return quoteDto(quote);
        if (quote.status !== 'PAYMENT_PENDING' && quote.status !== 'RECONCILING') {
          conflict('PAYMENT_FAILED', '실패 처리할 수 없는 결제입니다.');
        }
        return release(tx, quote, time, currency);
      });
    },
    async finalizeTrade(rawQuoteId: string, rawAttemptId: string) {
      const id = uuid.parse(rawQuoteId);
      const attemptId = uuid.parse(rawAttemptId);
      const existingTrade = async (tx: TradingTransaction) => {
        const [trade] = await tx.trades.find({ matchQuoteId: id });
        if (trade && trade.paymentAttemptId !== attemptId) conflict('PAYMENT_REQUIRED', '체결의 결제 시도 ID가 다릅니다.');
        return trade ? tradeDto(trade) : null;
      };
      const previous = await run(existingTrade);
      if (previous) return previous;
      const record = await readEvidence(id, attemptId, ['SETTLED']);
      return run(async (tx, time) => {
        const existing = await existingTrade(tx);
        if (existing) return existing;
        const quote = await getQuote(tx, id);
        requirePaymentBinding(quote, record);
        if (quote.status !== 'PAYMENT_PENDING' && quote.status !== 'RECONCILING' && quote.status !== 'SETTLED') {
          conflict('QUOTE_EXPIRED', '체결할 수 없는 예약입니다.');
        }
        const listing = await reservedListing(tx, quote);
        await tx.quotes.replace({ ...quote, status: 'COMPLETED' }, { status: quote.status, paymentAttemptId: attemptId });
        await tx.listings.replace({ ...listing, status: 'SOLD' }, { status: 'RESERVED' });
        await updateInventory(tx, listing, 'AVAILABLE', quote.buyerId);
        await resolveOrder(tx, quote, time, true);
        const trade = {
          id: randomUUID(), matchQuoteId: id, buyerId: quote.buyerId, sellerId: listing.sellerId,
          inventoryItemId: quote.inventoryItemId, price: quote.amount, paymentAttemptId: attemptId, completedAt: time,
        };
        await tx.trades.insert(trade);
        return tradeDto(trade);
      });
    },
  };
}

export type TradingService = ReturnType<typeof createTradingService>;
