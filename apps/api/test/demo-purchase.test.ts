import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { parseApiEnv } from '@tcg/config';
import { readDemoScenarios } from '@tcg/db';
import { createMockTradingStore, createTradingService } from '@tcg/trading';
import { createPaymentService, createPaymentEvidenceReader, createPolicyService, getPolicyExecutionContext } from '@tcg/payment-server';
import { createMcpPlugin } from '@tcg/mcp-server';
import type { AgentPurchaseOffer, AgentPurchaseProgress } from '@tcg/contracts';
import { createDemoPurchaseHandler } from '../src/demo-purchase.js';
import { demoBuyerId, demoBuyerAgentId } from '../src/demo-auth.js';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function fixture(unknown = false) {
  const pack = await readDemoScenarios();
  const buyer = { userId: demoBuyerId, agentId: demoBuyerAgentId };
  const wallet = `0x${'2'.repeat(40)}`;
  const recipient = `0x${'1'.repeat(40)}`;
  const env = parseApiEnv({ NODE_ENV: 'test', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/unused', CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', DEMO_SCENARIOS_ENABLED: 'true', PAYMENT_ENABLED: 'true', AGENT_WALLET_ADDRESS: wallet, PAYMENT_RECIPIENT: recipient, DEMO_BUYER_TOKEN: 'b'.repeat(32), DEMO_SELLER_TOKEN: 's'.repeat(32) });
  const inventory = pack.scenarios.map(scene => ({ id: randomUUID(), cardVariantId: scene.cardId, ownerId: pack.sellerId, status: 'AVAILABLE' as const }));
  const store = createMockTradingStore(inventory);
  const trading = createTradingService({ store, payment: createPaymentEvidenceReader(store), executionInTransaction: getPolicyExecutionContext });
  const policies = createPolicyService({ store });
  const adapter = { verify: vi.fn(async () => ({ valid: true })), settle: vi.fn(async () => ({ status: unknown ? 'UNKNOWN' as const : 'SETTLED' as const, ...(unknown ? {} : { transactionHash: `0x${'a'.repeat(64)}` }) })), reconcile: vi.fn(async () => ({ status: 'UNKNOWN' as const })) };
  const payments = createPaymentService({ store, tradingService: trading, adapter, recipient, getWalletAddress: async () => wallet });
  const offers: AgentPurchaseOffer[] = [];
  for (const [index, scene] of pack.scenarios.entries()) {
    const listing = await trading.createListing({ userId: pack.sellerId }, { inventoryItemId: inventory[index]!.id, price: scene.listingPrices[0]! }, { idempotencyKey: randomUUID() });
    offers.push({ listingId: listing.id, card: { id: scene.cardId, game: 'POKEMON', name: scene.id, setCode: 'demo', cardNumber: String(index), language: 'EN', edition: scene.edition, condition: scene.condition }, price: listing.price, dataSource: 'SYNTHETIC_DEMO', paymentMode: 'X402_BASE_SEPOLIA', paymentReady: true });
  }
  const app = Fastify(); apps.push(app);
  await app.register(createMcpPlugin({ aggregatorService: { async searchCards() { return offers.map(offer => offer.card); }, async getCardVariant(id) { return offers.find(offer => offer.card.id === id)?.card ?? null; } }, valuationService: { async getValuation() { throw new Error('Not used'); } }, tradingService: trading, paymentService: payments, getAuth: request => request.headers.authorization === `Bearer ${env.DEMO_BUYER_TOKEN}` ? buyer : null }));
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const purchase = createDemoPurchaseHandler({ env, trading, policies, getMcpUrl: () => `${url}/mcp` });
  const input = (offer: AgentPurchaseOffer) => ({ offer, listingId: offer.listingId, requestId: randomUUID(), sessionId: randomUUID(), auth: { userId: randomUUID() } });
  const payload = (prepared: AgentPurchaseProgress) => ({ x402Version: 2, accepted: prepared.requirements!, payload: { authorization: { from: wallet, to: recipient, value: prepared.amount, nonce: `0x${'b'.repeat(64)}`, validAfter: '0', validBefore: '9999999999' }, signature: `0x${'c'.repeat(130)}` } });
  return { purchase, input, payload, offers, adapter, trading, policies, buyer, store, inventory };
}

it('세 시나리오를 실제 MCP로 예약·지급·체결하고 재요청 시 중복 지급하지 않는다', async () => {
  const f = await fixture();
  for (const offer of f.offers) {
    const input = f.input(offer);
    const prepared = await f.purchase({ ...input, action: 'prepare' });
    expect(prepared.status).toBe('PAYMENT_REQUIRED');
    expect(prepared.requirements?.amount).toBe(offer.price);
    expect((await f.trading.getListing(offer.listingId)).status).toBe('RESERVED');
    const signed = { ...input, action: 'submit' as const, paymentPayload: f.payload(prepared) };
    const completed = await f.purchase(signed);
    expect(completed.status).toBe('COMPLETED');
    expect((await f.purchase(signed)).tradeId).toBe(completed.tradeId);
    expect((await f.trading.getListing(offer.listingId)).status).toBe('SOLD');
  }
  expect(f.adapter.settle).toHaveBeenCalledTimes(3);
  expect(await f.trading.listTrades(f.buyer)).toHaveLength(3);
  const [policy] = await f.policies.list(f.buyer);
  expect(await f.policies.budget(f.buyer, policy!.id)).toMatchObject({ spentAmount: '35000', reservedAmount: '0' });
  const owned = await f.store.transaction(tx => tx.inventory.find({ ownerId: f.buyer.userId }));
  expect(owned).toHaveLength(3);
});

it('지급 전 취소는 매물을 되돌리고 잘못된 수납 주소의 서명은 정산하지 않는다', async () => {
  const f = await fixture(); const input = f.input(f.offers[0]!);
  const prepared = await f.purchase({ ...input, action: 'prepare' });
  const payload = f.payload(prepared); payload.payload.authorization.to = `0x${'9'.repeat(40)}`;
  await expect(f.purchase({ ...input, action: 'submit', paymentPayload: payload })).rejects.toThrow();
  expect(f.adapter.settle).not.toHaveBeenCalled();
  expect((await f.purchase({ ...input, action: 'cancel' })).status).toBe('CANCELLED');
  expect((await f.trading.getListing(input.listingId)).status).toBe('ACTIVE');
});

it('결제 미확정이면 조회·재제출로 새 정산을 만들지 않는다', async () => {
  const f = await fixture(true); const input = f.input(f.offers[0]!);
  const prepared = await f.purchase({ ...input, action: 'prepare' });
  const signed = { ...input, action: 'submit' as const, paymentPayload: f.payload(prepared) };
  expect((await f.purchase(signed)).status).toBe('PENDING');
  expect((await f.purchase(signed)).status).toBe('PENDING');
  expect((await f.purchase({ ...input, action: 'status' })).status).toBe('PENDING');
  expect(f.adapter.settle).toHaveBeenCalledTimes(1);
  expect(await f.trading.listTrades(f.buyer)).toEqual([]);
});
