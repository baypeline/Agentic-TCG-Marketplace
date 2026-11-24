import { AppError, type BuyOrder, type InventoryItem, type Listing, type MatchQuote, type Trade } from '@tcg/contracts';
import type { PrismaClient } from '@tcg/db';
import { demoCards } from '@tcg/contracts/fixtures';

type ListingRow = Omit<Listing, 'createdAt'> & { createdAt: Date };
type OrderRow = Omit<BuyOrder, 'createdAt' | 'expiresAt'> & { buyerId: string; createdAt: Date; expiresAt: Date };
type QuoteRow = Omit<MatchQuote, 'buyOrderId' | 'currency' | 'expiresAt' | 'policyId'> & {
  buyerId: string;
  policyId: string | null;
  buyOrderId: string | null;
  paymentAttemptId: string | null;
  expiresAt: Date;
};
type TradeRow = Omit<Trade, 'status' | 'completedAt'> & { completedAt: Date };
export interface TradingRequestRow {
  id: string;
  userId: string;
  agentId: string | null;
  operation: string;
  requestKey: string;
  inputHash: string;
  resultJson: string;
}

export function listingDto(row: ListingRow): Listing {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

export function orderDto({ buyerId: _, ...row }: OrderRow): BuyOrder {
  return { ...row, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString() };
}

export function quoteDto({ buyerId: _, paymentAttemptId: __, policyId: ___, buyOrderId, ...row }: QuoteRow): MatchQuote {
  return { ...row, currency: 'USDC', ...(buyOrderId ? { buyOrderId } : {}), expiresAt: row.expiresAt.toISOString() };
}

export function tradeDto(row: TradeRow): Trade {
  return { ...row, status: 'COMPLETED', completedAt: row.completedAt.toISOString() };
}

type RecordId = { id: string };
type Filter<Row> = { [Key in keyof Row]?: Row[Key] extends Date ? { lte: Date } : Row[Key] };

interface Table<Row extends RecordId> {
  get(id: string): Promise<Row | null>;
  find(where: Filter<Row>): Promise<Row[]>;
  insert(row: Row): Promise<void>;
  replace(row: Row, expected: Filter<Row>): Promise<void>;
}

export interface PolicyRow { id: string; userId: string; agentId: string; version: number; policyJson: string; totalBudget: string; spentAmount: string; reservedAmount: string }
export interface PolicyVersionRow { id: string; policyId: string; version: number; policyJson: string; createdAt: Date }
export interface PaymentRow { id: string; matchQuoteId: string; userId: string; agentId: string; policyId: string; policyVersion: number; amount: string; status: string; requirementsJson: string; payloadHash: string | null; transactionHash: string | null; submittedAt: Date | null; updatedAt: Date; needsReview: boolean }
export interface RunRow { id: string; userId: string; agentId: string; policyId: string; instruction: string; status: string; expiresAt: Date; result: string | null }

export interface TradingTransaction {
  inventory: Table<InventoryItem>;
  listings: Table<ListingRow>;
  orders: Table<OrderRow>;
  quotes: Table<QuoteRow>;
  trades: Table<TradeRow>;
  requests: Table<TradingRequestRow>;
  policies: Table<PolicyRow>;
  versions: Table<PolicyVersionRow>;
  payments: Table<PaymentRow>;
  runs: Table<RunRow>;
  hasCard(id: string): Promise<boolean>;
}

export interface TradingStore {
  transaction<T>(work: (tx: TradingTransaction) => Promise<T>): Promise<T>;
}

class TradingConflict extends Error {}

interface Delegate<Row extends RecordId> {
  findUnique(args: { where: { id: string } }): PromiseLike<Row | null>;
  findMany(args: { where: Filter<Row> }): PromiseLike<Row[]>;
  create(args: { data: Row }): PromiseLike<Row>;
  updateMany(args: { where: Filter<Row> & RecordId; data: Row }): PromiseLike<{ count: number }>;
}

function prismaTable<Row extends RecordId>(delegate: Delegate<Row>): Table<Row> {
  return {
    async get(id) { return delegate.findUnique({ where: { id } }); },
    async find(where) { return delegate.findMany({ where }); },
    async insert(row) { await delegate.create({ data: row }); },
    async replace(row, expected) {
      const result = await delegate.updateMany({ where: { ...expected, id: row.id }, data: row });
      if (result.count !== 1) throw new TradingConflict();
    },
  };
}

export function createPrismaTradingStore(prisma: PrismaClient): TradingStore {
  return {
    async transaction(work) {
      for (let attempt = 0; attempt < 5; attempt++) {
        try {
          return await prisma.$transaction(tx => work({
            inventory: prismaTable<InventoryItem>(tx.inventoryItem),
            listings: prismaTable<ListingRow>(tx.listing),
            orders: prismaTable<OrderRow>(tx.buyOrder),
            quotes: prismaTable<QuoteRow>(tx.matchQuote),
            trades: prismaTable<TradeRow>(tx.trade),
            requests: prismaTable<TradingRequestRow>(tx.tradingRequest),
            policies: prismaTable<PolicyRow>(tx.spendingPolicy),
            versions: prismaTable<PolicyVersionRow>(tx.policyVersion),
            payments: prismaTable<PaymentRow>(tx.paymentAttempt),
            runs: prismaTable<RunRow>(tx.agentRun),
            async hasCard(id) { return (await tx.cardVariant.count({ where: { id } })) > 0; },
          }), { isolationLevel: 'Serializable' });
        } catch (error) {
          const code = error instanceof Error && 'code' in error ? error.code : null;
          if (!(error instanceof TradingConflict) && code !== 'P2034' && code !== 'P2002') throw error;
          if (attempt < 4) await new Promise(resolve => setTimeout(resolve, 5 * (attempt + 1)));
        }
      }
      throw new AppError('INVENTORY_CONFLICT', '거래 상태가 변경되었습니다. 다시 시도하세요.', 409, true);
    },
  };
}

function mockTable<Row extends RecordId>(rows: Map<string, Row>): Table<Row> {
  const matches = (row: Row, where: Filter<Row>) => Object.entries(where).every(([key, value]) => {
    const actual = row[key as keyof Row];
    return actual instanceof Date ? actual <= value.lte : actual === value;
  });
  return {
    async get(id) { return rows.get(id) ?? null; },
    async find(where) { return [...rows.values()].filter(row => matches(row, where)); },
    async insert(row) {
      if (rows.has(row.id)) throw new TradingConflict();
      rows.set(row.id, row);
    },
    async replace(row, expected) {
      const current = rows.get(row.id);
      if (!current || !matches(current, expected)) throw new TradingConflict();
      rows.set(row.id, row);
    },
  };
}

export const demoSellerId = '00000000-0000-4000-8002-000000000001';
export const demoInventory: readonly InventoryItem[] = Array.from({ length: 6 }, (_, index) => ({
  id: `00000000-0000-4000-8003-${String(index + 1).padStart(12, '0')}`,
  cardVariantId: demoCards[Math.floor(index / 2)]!.id,
  ownerId: demoSellerId,
  status: 'AVAILABLE',
}));

export function createMockTradingStore(items: readonly InventoryItem[] = demoInventory): TradingStore {
  const cards = new Set([...demoCards, ...items].map(item => 'cardVariantId' in item ? item.cardVariantId : item.id));
  let state = {
    inventory: new Map(items.map(item => [item.id, { ...item }])),
    listings: new Map<string, ListingRow>(),
    orders: new Map<string, OrderRow>(),
    quotes: new Map<string, QuoteRow>(),
    trades: new Map<string, TradeRow>(),
    requests: new Map<string, TradingRequestRow>(),
    policies: new Map<string, PolicyRow>(), versions: new Map<string, PolicyVersionRow>(),
    payments: new Map<string, PaymentRow>(), runs: new Map<string, RunRow>(),
  };
  let queue = Promise.resolve();
  return {
    transaction(work) {
      const result = queue.then(async () => {
        const next = {
          inventory: new Map(state.inventory), listings: new Map(state.listings), orders: new Map(state.orders),
          quotes: new Map(state.quotes), trades: new Map(state.trades),
          requests: new Map(state.requests),
          policies: new Map(state.policies), versions: new Map(state.versions), payments: new Map(state.payments), runs: new Map(state.runs),
        };
        const value = await work({
          inventory: mockTable(next.inventory), listings: mockTable(next.listings), orders: mockTable(next.orders),
          quotes: mockTable(next.quotes), trades: mockTable(next.trades),
          requests: mockTable(next.requests),
          policies: mockTable(next.policies), versions: mockTable(next.versions), payments: mockTable(next.payments), runs: mockTable(next.runs),
          async hasCard(id) { return cards.has(id); },
        });
        state = next;
        return value;
      });
      queue = result.then(() => undefined, () => undefined);
      return result;
    },
  };
}
