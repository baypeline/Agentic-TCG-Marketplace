import { getPaymentProfile, type PaymentChain } from '@tcg/contracts/payment-profile';
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

async function fixture(unknown = false, serverSigning = false, paymentChain: PaymentChain = 'base-sepolia', includeKorean = false) {
  const pack = await readDemoScenarios(paymentChain, includeKorean);
  const profile = getPaymentProfile(paymentChain);
  const buyer = { userId: demoBuyerId, agentId: demoBuyerAgentId };
  const wallet = `0x${'2'.repeat(40)}`;
  const recipient = `0x${'1'.repeat(40)}`;
  const env = parseApiEnv({ NODE_ENV: 'test', PAYMENT_CHAIN: paymentChain, PAYMENT_FACILITATOR_URL: 'http://127.0.0.1:4022', AGENT_SIGNING_MODE: serverSigning ? 'server' : 'browser', AGENT_SERVER_WALLET_ADDRESS: wallet, DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/unused', CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', DEMO_SCENARIOS_ENABLED: 'true', PAYMENT_ENABLED: 'true', AGENT_WALLET_ADDRESS: wallet, PAYMENT_RECIPIENT: recipient, DEMO_BUYER_TOKEN: 'b'.repeat(32), DEMO_SELLER_TOKEN: 's'.repeat(32) });
  const inventory = pack.scenarios.map(scene => ({ id: randomUUID(), cardVariantId: scene.cardId, ownerId: pack.sellerId, status: 'AVAILABLE' as const }));
  const store = createMockTradingStore(inventory);
  const trading = createTradingService({ store, currency: profile.currency, payment: createPaymentEvidenceReader(store, profile.currency), executionInTransaction: getPolicyExecutionContext });
  const policies = createPolicyService({ store });
  const adapter = { verify: vi.fn(async () => ({ valid: true })), settle: vi.fn(async () => ({ status: unknown ? 'UNKNOWN' as const : 'SETTLED' as const, ...(unknown ? {} : { transactionHash: `0x${'a'.repeat(64)}` }) })), reconcile: vi.fn(async () => ({ status: 'UNKNOWN' as const })) };
  const payments = createPaymentService({ paymentChain, store, tradingService: trading, adapter, recipient, getWalletAddress: async () => wallet });
  const offers: AgentPurchaseOffer[] = [];
  for (const [index, scene] of pack.scenarios.entries()) {
    const listing = await trading.createListing({ userId: pack.sellerId }, { inventoryItemId: inventory[index]!.id, price: scene.listingPrices[0]! }, { idempotencyKey: randomUUID() });
    offers.push({ listingId: listing.id, card: { id: scene.cardId, game: 'POKEMON', name: scene.id, setCode: 'demo', cardNumber: String(index), language: 'EN', edition: scene.edition, condition: scene.condition }, price: listing.price, dataSource: 'SYNTHETIC_DEMO', paymentMode: profile.paymentMode, currency: profile.currency, paymentReady: true });
  }
  const app = Fastify(); apps.push(app);
  await app.register(createMcpPlugin({ aggregatorService: { async searchCards() { return offers.map(offer => offer.card); }, async getCardVariant(id) { return offers.find(offer => offer.card.id === id)?.card ?? null; } }, valuationService: { async getValuation() { throw new Error('Not used'); } }, tradingService: trading, paymentService: payments, getAuth: request => request.headers.authorization === `Bearer ${env.DEMO_BUYER_TOKEN}` ? buyer : null }));
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  const input = (offer: AgentPurchaseOffer) => ({ offer, listingId: offer.listingId, requestId: randomUUID(), sessionId: randomUUID(), auth: { userId: randomUUID() } });
  const payload = (prepared: AgentPurchaseProgress) => ({ x402Version: 2, accepted: prepared.requirements!, payload: { authorization: { from: wallet, to: recipient, value: prepared.amount, nonce: `0x${'b'.repeat(64)}`, validAfter: '0', validBefore: '9999999999' }, signature: `0x${'c'.repeat(130)}` } });
  const signer = vi.fn(async (value: { requirements: NonNullable<AgentPurchaseProgress['requirements']>; amount: string }) => payload(value as AgentPurchaseProgress));
  const purchase = createDemoPurchaseHandler({ includeKorean, env: { ...env, AGENT_SIGNING_MODE: serverSigning ? 'server' : 'browser' }, trading, policies, signAgentPayment: serverSigning ? signer : undefined, getMcpUrl: () => `${url}/mcp` });
  return { purchase, input, payload, offers, adapter, trading, policies, buyer, store, inventory, signer };
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

it('마루 원장의 tOKRW 금액으로 MCP 지급·체결·누적 예산을 처리한다', async () => {
  const f = await fixture(false, true, 'maroo');
  const input = f.input(f.offers[2]!);
  const prepared = await f.purchase({ ...input, action: 'prepare' });
  expect(prepared).toMatchObject({ currency: 'tOKRW', paymentMode: 'X402_MAROO_NATIVE', amount: '5000000000000000000', requirements: { network: 'eip155:450815', scheme: 'maroo-native', asset: 'native:tOKRW' } });
  expect((await f.purchase({ ...input, action: 'submit' })).status).toBe('COMPLETED');
  const [policy] = await f.policies.list(f.buyer);
  expect(policy).toMatchObject({ totalBudget: '100000000000000000000', maxPerTrade: '25000000000000000000' });
  expect(await f.policies.budget(f.buyer, policy!.id)).toMatchObject({ spentAmount: '5000000000000000000' });
  expect((await f.purchase({ ...input, action: 'submit' })).status).toBe('COMPLETED');
  expect(f.adapter.settle).toHaveBeenCalledTimes(1);
});
it('한국어 매물을 기존 정책에 추가해도 기존 지출과 예산을 유지한다',async()=>{
 const f=await fixture(false,true,'maroo',true);
 const legacy=f.input(f.offers[0]!);await f.purchase({...legacy,action:'prepare'});await f.purchase({...legacy,action:'submit'});
 const korean=f.input(f.offers[3]!);await f.purchase({...korean,action:'prepare'});expect((await f.purchase({...korean,action:'submit'})).status).toBe('COMPLETED');
 const [policy]=await f.policies.list(f.buyer);expect(policy!.allowedCardVariantIds).toHaveLength(23);expect(await f.policies.budget(f.buyer,policy!.id)).toMatchObject({spentAmount:'13000000000000000000',availableAmount:'87000000000000000000'});
});

it('이전 한국어판 기본 정책을 확장해 새 추천 카드를 예약하고 취소할 수 있다', async () => {
  const f = await fixture(false, true, 'maroo', true);
  const pack = await readDemoScenarios('maroo', true);
  const original = await readDemoScenarios('maroo');
  const profile = getPaymentProfile('maroo');
  const policy = await f.policies.create(f.buyer, { enabled: true, totalBudget: profile.totalBudget, maxPerTrade: profile.maxPerTrade, allowedCardVariantIds: original.scenarios.map(scene=>scene.cardId), validUntil: '2099-01-01T00:00:00.000Z' }, { idempotencyKey: 'scenario-demo-policy-v1' });
  await f.policies.update(f.buyer, policy.id, { ...policy, expectedVersion: 1, allowedCardVariantIds: pack.scenarios.slice(0,15).map(scene=>scene.cardId) }, { idempotencyKey: 'scenario-korean-cards-v1' });
  const input = f.input(f.offers[15]!);
  expect((await f.purchase({ ...input, action: 'prepare' })).status).toBe('PAYMENT_REQUIRED');
  expect((await f.policies.get(f.buyer, policy.id)).allowedCardVariantIds).toHaveLength(23);
  expect((await f.purchase({ ...input, action: 'cancel' })).status).toBe('CANCELLED');
  expect(await f.policies.budget(f.buyer, policy.id)).toMatchObject({ spentAmount: '0', reservedAmount: '0', availableAmount: profile.totalBudget });
});

it('사용자 지정 정책에는 한국어판 허용 목록을 자동 추가하지 않는다', async () => {
  const f = await fixture(false, true, 'maroo', true);
  const legacy = f.input(f.offers[0]!);
  await f.purchase({ ...legacy, action: 'prepare' });
  await f.purchase({ ...legacy, action: 'cancel' });
  const [policy] = await f.policies.list(f.buyer);
  const custom = await f.policies.update(f.buyer, policy!.id, { ...policy!, expectedVersion: policy!.version, allowedCardVariantIds: [f.offers[0]!.card.id] }, { idempotencyKey: randomUUID() });
  await expect(f.purchase({ ...f.input(f.offers[3]!), action: 'prepare' })).rejects.toThrow();
  expect((await f.policies.get(f.buyer, custom.id)).allowedCardVariantIds).toEqual([f.offers[0]!.card.id]);
  expect(f.signer).not.toHaveBeenCalled();
  expect(f.adapter.settle).not.toHaveBeenCalled();
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

it('서버 서명으로 MCP 결제·소유권 이전을 완료하고 재제출 시 서명과 정산을 반복하지 않는다', async () => {
  const f = await fixture(false, true); const input = f.input(f.offers[0]!);
  expect((await f.purchase({ ...input, action: 'prepare' })).signingMode).toBe('server');
  const completed = await f.purchase({ ...input, action: 'submit' });
  expect(completed.status).toBe('COMPLETED');
  expect((await f.purchase({ ...input, action: 'submit' })).tradeId).toBe(completed.tradeId);
  expect(f.signer).toHaveBeenCalledTimes(1);
  expect(f.adapter.settle).toHaveBeenCalledTimes(1);
  expect(await f.store.transaction(tx => tx.inventory.find({ ownerId: f.buyer.userId }))).toHaveLength(1);
});

it('서버 결제가 UNKNOWN이면 재제출과 조회에서도 새 서명을 만들지 않는다', async () => {
  const f = await fixture(true, true); const input = f.input(f.offers[0]!);
  await f.purchase({ ...input, action: 'prepare' });
  expect((await f.purchase({ ...input, action: 'submit' })).status).toBe('PENDING');
  expect((await f.purchase({ ...input, action: 'submit' })).status).toBe('PENDING');
  expect((await f.purchase({ ...input, action: 'status' })).status).toBe('PENDING');
  expect(f.signer).toHaveBeenCalledTimes(1);
  expect(f.adapter.settle).toHaveBeenCalledTimes(1);
});

it('중단된 실행과 비활성 정책에는 서명하지 않고 브라우저 payload 주입을 거부한다', async () => {
  const f = await fixture(false, true); const input = f.input(f.offers[0]!);
  const prepared = await f.purchase({ ...input, action: 'prepare' });
  await expect(f.purchase({ ...input, action: 'submit', paymentPayload: f.payload(prepared) })).rejects.toThrow();
  const [run] = await f.policies.listRuns(f.buyer);
  await f.policies.stopRun(f.buyer, run!.id);
  await expect(f.purchase({ ...input, action: 'submit' })).rejects.toThrow();
  expect(f.signer).not.toHaveBeenCalled();
  expect(f.adapter.settle).not.toHaveBeenCalled();
});

it.each(['disabled', 'budget', 'expired'] as const)('예약 후 정책이 %s로 변경되면 서버가 서명하지 않는다', async change => {
  const f = await fixture(false, true); const input = f.input(f.offers[0]!);
  await f.purchase({ ...input, action: 'prepare' });
  const [policy] = await f.policies.list(f.buyer);
  await f.policies.update(f.buyer, policy!.id, { ...policy, expectedVersion: policy!.version,
    ...(change === 'disabled' ? { enabled: false } : change === 'budget' ? { totalBudget: '1', maxPerTrade: '1' } : { validUntil: '2000-01-01T00:00:00.000Z' }),
  }, { idempotencyKey: randomUUID() });
  await expect(f.purchase({ ...input, action: 'submit' })).rejects.toThrow();
  expect(f.signer).not.toHaveBeenCalled();
  expect(f.adapter.settle).not.toHaveBeenCalled();
});
