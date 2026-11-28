import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { parseApiEnv } from '@tcg/config';
import { createMockTradingStore } from '@tcg/trading';
import { createPolicyService } from '@tcg/payment-server';
import { createAgentBudgetHandler, createAgentBudgetStatePlugin } from '../src/agent-budget.js';
import Fastify from 'fastify';
import { demoBuyerId, demoBuyerAgentId } from '../src/demo-auth.js';

async function fixture() {
  const env = parseApiEnv({ NODE_ENV: 'test', PAYMENT_CHAIN: 'maroo', PAYMENT_FACILITATOR_URL: 'http://127.0.0.1:4022', AGENT_SIGNING_MODE: 'server', AGENT_SERVER_WALLET_ADDRESS: `0x${'2'.repeat(40)}`, DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/unused', CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', DEMO_SCENARIOS_ENABLED: 'true', PAYMENT_ENABLED: 'true', AGENT_WALLET_ADDRESS: `0x${'2'.repeat(40)}`, PAYMENT_RECIPIENT: `0x${'1'.repeat(40)}`, DEMO_BUYER_TOKEN: 'b'.repeat(32), DEMO_SELLER_TOKEN: 's'.repeat(32) });
  const store = createMockTradingStore(), policies = createPolicyService({ store });
  let time = new Date('2026-11-28T00:00:00Z');
  const handler = createAgentBudgetHandler(env, policies, () => time);
  const buyer = { userId: demoBuyerId, agentId: demoBuyerAgentId };
  const proposal = await handler.propose({ currency: 'tOKRW', totalBudget: '120', maxPerTrade: '10' });
  return { env, handler, policies, store, buyer, proposal, expire: () => { time = new Date('2026-11-28T00:06:00Z'); } };
}
it('확인 전에는 요청 예산을 저장하지 않고 확인 후 기존 소비·예약과 다른 정책 필드를 유지한다', async () => {
  const f = await fixture();
  const before = await f.policies.get(f.buyer, f.proposal.policyId);
  expect(before.totalBudget).toBe('100000000000000000000');
  await f.store.transaction(async tx => { const row = (await tx.policies.get(before.id))!; await tx.policies.replace({ ...row, spentAmount: '10000000000000000000', reservedAmount: '5000000000000000000' }, { version: row.version, spentAmount: row.spentAmount, reservedAmount: row.reservedAmount }); });
  const result = await f.handler.confirm(f.proposal);
  expect(result.policy).toMatchObject({ totalBudget: '120000000000000000000', maxPerTrade: '10000000000000000000', enabled: before.enabled, allowedCardVariantIds: before.allowedCardVariantIds, validUntil: before.validUntil });
  expect(result.budget).toMatchObject({ spentAmount: '10000000000000000000', reservedAmount: '5000000000000000000', availableAmount: '105000000000000000000' });
  expect((await f.handler.confirm(f.proposal)).policy?.version).toBe(result.policy?.version);
});

it('현재 예산 조회는 채팅과 같은 정책을 사용하고 로그인 사용자별로 분리한다', async () => {
  const f = await fixture();
  const alice = { userId: randomUUID(), agentId: randomUUID(), walletAddress: `0x${'8'.repeat(40)}` };
  const bob = { userId: randomUUID(), agentId: randomUUID(), walletAddress: `0x${'9'.repeat(40)}` };
  const proposal = await f.handler.propose({ currency: 'tOKRW', totalBudget: '80', maxPerTrade: '20' }, alice);
  await f.handler.confirm(proposal, alice);
  const app = Fastify(); app.decorateRequest('auth', null);
  app.addHook('onRequest', async request => { request.auth = request.headers.authorization === 'alice' ? alice : request.headers.authorization === 'bob' ? bob : null; });
  try {
    await app.register(createAgentBudgetStatePlugin(f.env, f.policies));
    const a = await app.inject({ url: '/api/agent/budget', headers: { authorization: 'alice' } });
    expect(a.json()).toMatchObject({ policy: { id: proposal.policyId, totalBudget: '80000000000000000000', maxPerTrade: '20000000000000000000' }, budget: { availableAmount: '80000000000000000000' }, currency: 'tOKRW' });
    const b = await app.inject({ url: '/api/agent/budget', headers: { authorization: 'bob' } });
    expect(b.json().policy.id).not.toBe(proposal.policyId);
    expect((await app.inject('/api/agent/budget')).statusCode).toBe(401);
  } finally { await app.close(); }
});
it('총예산만 변경해도 건당 한도를 임의로 바꾸지 않으며 통화·정밀도·서명 상한을 검증한다', async () => {
  const f = await fixture();
  const patch = { currency: 'tOKRW' as const, totalBudget: '120', maxPerTrade: null };
  expect((await f.handler.propose(patch)).maxPerTrade).toBe('25000000000000000000');
  for (const change of [{ currency: 'USDC' as const }, { totalBudget: '0' }, { maxPerTrade: '26' }, { maxPerTrade: '0.0000000000000000001' }, { totalBudget: '1' }]) await expect(f.handler.propose({ ...patch, ...change })).rejects.toThrow();
});
it('로그인 지갑의 예산은 다른 지갑과 기존 데모 정책으로부터 분리한다', async () => {
  const f = await fixture();
  const alice = { userId: randomUUID(), agentId: randomUUID(), walletAddress: `0x${'8'.repeat(40)}` };
  const bob = { userId: randomUUID(), agentId: randomUUID(), walletAddress: `0x${'9'.repeat(40)}` };
  const patch = { currency: 'tOKRW' as const, totalBudget: '120', maxPerTrade: '10' };
  const a = await f.handler.propose(patch, alice), b = await f.handler.propose(patch, bob);
  expect(a.policyId).not.toBe(b.policyId); expect(a.policyId).not.toBe(f.proposal.policyId);
  await expect(f.handler.confirm(a, bob)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await f.handler.confirm(a, alice);
  expect((await f.policies.get(bob, b.policyId)).totalBudget).toBe('100000000000000000000');
  expect((await f.policies.get(f.buyer, f.proposal.policyId)).totalBudget).toBe('100000000000000000000');
});
it('확인 시점의 지출·예약 증가, 정책 수정과 변경안 만료를 재검사한다', async () => {
  const f = await fixture();
  const low = await f.handler.propose({ currency: 'tOKRW', totalBudget: '50', maxPerTrade: null });
  await f.store.transaction(async tx => { const row = (await tx.policies.get(low.policyId))!; await tx.policies.replace({ ...row, spentAmount: '60000000000000000000' }, { version: row.version, spentAmount: row.spentAmount, reservedAmount: row.reservedAmount }); });
  await expect(f.handler.confirm(low)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  await expect(f.handler.propose({ currency: 'tOKRW', totalBudget: '50', maxPerTrade: null })).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  const current = await f.policies.get(f.buyer, low.policyId);
  await f.policies.update(f.buyer, current.id, { ...current, expectedVersion: current.version, maxPerTrade: '20000000000000000000' }, { idempotencyKey: 'settings-edit' });
  await expect(f.handler.confirm(f.proposal)).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  f.expire(); await expect(f.handler.confirm(f.proposal)).rejects.toThrow('만료');
});
