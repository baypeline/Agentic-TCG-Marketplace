import { randomUUID } from 'node:crypto';
import { vi } from 'vitest';
import { createMockTradingStore, createTradingService, demoInventory, demoSellerId, type TradingStore } from '@tcg/trading';
import { createPolicyService, getPolicyExecutionContext, createPaymentService, createPaymentEvidenceReader, type SettlementAdapter } from '../src/index.js';

export const seller = { userId: demoSellerId };
export const buyer = { userId: randomUUID(), agentId: randomUUID() };
const recipient = '0x1111111111111111111111111111111111111111';
const wallet = '0x2222222222222222222222222222222222222222';
export const request = () => ({ idempotencyKey: randomUUID() });
export async function commerceFixture(store: TradingStore = createMockTradingStore(), inventory = demoInventory) {
  let clock = Date.parse('2026-11-24T00:00:00Z');
  const now = () => new Date(clock);
  const adapter: SettlementAdapter = { verify: vi.fn(async () => ({ valid: true })), settle: vi.fn(async () => ({ status: 'SETTLED' as const, transactionHash: '0x'+'1'.repeat(64) })), reconcile: vi.fn(async () => ({ status: 'UNKNOWN' as const })) };
  const trading = createTradingService({ store, executionInTransaction: getPolicyExecutionContext, payment: createPaymentEvidenceReader(store), now });
  const policies = createPolicyService({ store, now, onInactive: auth => trading.pauseAgentOrders(auth) });
  const fields = { enabled: true, totalBudget: '30000000', maxPerTrade: '20000000', validUntil: '2099-01-01T00:00:00.000Z' };
  const policy = await policies.create(buyer, fields, request());
  const run = await policies.startRun(buyer, { policyId: policy.id, instruction: '피카츄 구매' }, request());
  const payments = createPaymentService({ store, tradingService: trading, adapter, recipient, getWalletAddress: async () => wallet, now, reviewAfterMs: 1000 });
  async function reserve(index = 0, amount = '10000000') {
    const item = inventory[index]!;
    const listing = await trading.createListing(seller, { inventoryItemId: item.id, price: amount }, request());
    return trading.quoteFixedPurchase(buyer, { listingId: listing.id, maxPrice: amount }, request());
  }
  async function signed(quote: { id: string }) {
    const prepared = await payments.preparePayment({ matchQuoteId: quote.id, agentId: buyer.agentId }, buyer);
    return { matchQuoteId: quote.id, agentId: buyer.agentId, paymentPayload: { x402Version: 2, accepted: prepared.requirements, payload: { authorization: { from: wallet, to: recipient, value: prepared.requirements.amount, nonce: '0x'+'a'.repeat(64), validAfter: '0', validBefore: '9999999999' }, signature: '0x'+'b'.repeat(130) } } };
  }
  return { store, buyer, fields, policy, run, policies, trading, payments, adapter, reserve, signed, advance(ms: number) { clock += ms; } };
}

