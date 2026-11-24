import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { createPolicyService } from '../src/index.js';
import { commerceFixture, buyer, seller, request } from './commerce-fixture.js';

it('정책 수정·재시작·여러 세션에도 예산과 버전을 보존하고 하한 미만 감액을 거부한다', async () => {
  const f = await commerceFixture(); const quote = await f.reserve();
  await f.payments.processSignedPayment(await f.signed(quote), buyer);
  const secondSession = await f.policies.startRun(buyer, { policyId: f.policy.id, instruction: '다음 작업' }, request());
  await f.policies.stopRun(buyer, f.run.id);
  expect((await f.policies.budget(buyer, f.policy.id)).spentAmount).toBe('10000000');
  const restarted = createPolicyService({ store: f.store });
  expect((await restarted.budget(buyer, f.policy.id)).availableAmount).toBe('20000000');
  await expect(f.policies.update(buyer, f.policy.id, { ...f.fields, totalBudget: '9999999', maxPerTrade: '1', expectedVersion: 1 }, request())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  const updated = await f.policies.update(buyer, f.policy.id, { ...f.fields, totalBudget: '25000000', expectedVersion: 1 }, request());
  expect(updated).toMatchObject({ id: f.policy.id, version: 2 });
  expect(await f.policies.versions(buyer, f.policy.id)).toHaveLength(2);
  expect((await f.policies.getRun(buyer, secondSession.id)).status).toBe('RUNNING');
});

it('정책을 낮추면 기존 예약은 유지·보류하고 원래 TTL에 해제한다', async () => {
  const f = await commerceFixture(); const quote = await f.reserve(); const signed = await f.signed(quote);
  await f.policies.update(buyer, f.policy.id, { ...f.fields, maxPerTrade: '5000000', expectedVersion: 1 }, request());
  await expect(f.payments.processSignedPayment(signed, buyer)).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  const status = await f.payments.getPaymentStatus(quote.id, buyer);
  expect(status.holdReasons.length).toBeGreaterThan(0);
  expect(status.expiresAt).toBe(quote.expiresAt);
  expect((await f.trading.getMatch(buyer, quote.id)).status).toBe('RESERVED');
  expect(f.adapter.settle).not.toHaveBeenCalled();
  f.advance(120001); await f.trading.expireReservations();
  expect((await f.trading.getMatch(buyer, quote.id)).status).toBe('RELEASED');
});

it('동시 결제와 중복 재시도는 예산을 한 번만 예약하고 한 번만 정산한다', async () => {
  const f = await commerceFixture(); const quote = await f.reserve(); const input = await f.signed(quote);
  await Promise.all([f.payments.processSignedPayment(input, buyer), f.payments.processSignedPayment(input, buyer)]);
  expect(f.adapter.settle).toHaveBeenCalledTimes(1);
  expect((await f.policies.budget(buyer, f.policy.id))).toMatchObject({ spentAmount: '10000000', reservedAmount: '0' });
  expect((await f.payments.getPaymentStatus(quote.id, buyer))).toMatchObject({ paymentStatus: 'SETTLED', tradeStatus: 'COMPLETED' });
});

it('UNKNOWN은 중단·TTL·재시도에도 예산과 카드를 보호하고 새 지급하지 않는다', async () => {
  const f = await commerceFixture(); vi.mocked(f.adapter.settle).mockRejectedValueOnce(new Error('timeout'));
  const quote = await f.reserve(); const input = await f.signed(quote);
  await f.payments.processSignedPayment(input, buyer);
  await f.policies.stopRun(buyer, f.run.id); f.advance(180000);
  await f.trading.expireReservations(); await f.payments.processSignedPayment(input, buyer); await f.payments.recover();
  expect(f.adapter.settle).toHaveBeenCalledTimes(1);
  expect((await f.policies.budget(buyer, f.policy.id))).toMatchObject({ spentAmount: '0', reservedAmount: '10000000' });
  expect(await f.payments.getPaymentStatus(quote.id, buyer)).toMatchObject({ paymentStatus: 'UNKNOWN', needsReview: true, retryPaymentAllowed: false });
  await expect(f.policies.update(buyer, f.policy.id, { ...f.fields, totalBudget: '9999999', maxPerTrade: '1', expectedVersion: 1 }, request())).rejects.toMatchObject({ code: 'BUDGET_EXCEEDED' });
  vi.mocked(f.adapter.reconcile).mockResolvedValueOnce({ status: 'SETTLED', transactionHash: '0x'+'1'.repeat(64) });
  await f.payments.recover();
  expect(await f.payments.getPaymentStatus(quote.id, buyer)).toMatchObject({ paymentStatus: 'SETTLED', tradeStatus: 'COMPLETED' });
});

it('결제 후 체결 실패는 SETTLED를 보존하고 거래만 복구하며 모의 수익을 한 번 집계한다', async () => {
  const f = await commerceFixture(); const finalize = vi.spyOn(f.trading, 'finalizeTrade').mockRejectedValueOnce(new Error('db write failed'));
  const quote = await f.reserve(); await f.payments.processSignedPayment(await f.signed(quote), buyer);
  expect(await f.payments.getPaymentStatus(quote.id, buyer)).toMatchObject({ paymentStatus: 'SETTLED', tradeStatus: 'FINALIZING' });
  expect((await f.trading.sellerProceeds(seller)).amount).toBe('0');
  f.advance(1001);
  expect(await f.payments.getPaymentStatus(quote.id, buyer)).toMatchObject({ needsReview: true });
  await f.payments.recover(); await f.payments.recover();
  expect(await f.payments.getPaymentStatus(quote.id, buyer)).toMatchObject({ needsReview: false });
  expect((await f.trading.sellerProceeds(seller))).toMatchObject({ amount: '10000000', tradeCount: 1, withdrawable: false });
  expect(f.adapter.settle).toHaveBeenCalledTimes(1); expect(finalize.mock.calls.length).toBeGreaterThan(1);
});

it('확정 실패만 예산을 반환하며 다른 사용자·Agent는 접근하지 못한다', async () => {
  const f = await commerceFixture(); vi.mocked(f.adapter.settle).mockResolvedValueOnce({ status: 'FAILED', definitive: true });
  const quote = await f.reserve(); await f.payments.processSignedPayment(await f.signed(quote), buyer);
  expect(await f.policies.budget(buyer, f.policy.id)).toMatchObject({ reservedAmount: '0', spentAmount: '0' });
  expect((await f.trading.getMatch(buyer, quote.id)).status).toBe('RELEASED');
  await expect(f.policies.budget({ ...buyer, userId: randomUUID() }, f.policy.id)).rejects.toMatchObject({ code: 'FORBIDDEN' });
  await expect(f.payments.getPaymentStatus(quote.id, { ...buyer, agentId: randomUUID() })).rejects.toMatchObject({ code: 'FORBIDDEN' });
});

it('제출 승인 이후 정책을 낮춰도 기존 결제의 승인 버전과 예산 보호를 유지한다', async () => {
  const f = await commerceFixture();
  let entered!: () => void, finish!: () => void;
  const submitted = new Promise<void>(resolve => { entered = resolve; });
  const gateway = new Promise<void>(resolve => { finish = resolve; });
  vi.mocked(f.adapter.settle).mockImplementationOnce(async () => { entered(); await gateway; return { status: 'SETTLED', transactionHash: '0x'+'1'.repeat(64) }; });
  const quote = await f.reserve();
  const payment = f.payments.processSignedPayment(await f.signed(quote), buyer);
  await submitted;
  const updated = await f.policies.update(buyer, f.policy.id, { ...f.fields, maxPerTrade: '5000000', expectedVersion: 1 }, request());
  expect(updated.version).toBe(2);
  expect((await f.policies.budget(buyer, f.policy.id)).reservedAmount).toBe('10000000');
  finish();
  expect(await payment).toMatchObject({ paymentStatus: 'SETTLED', policyVersion: 1 });
});

it('서버 작업 키는 재시작에도 유지되고 새 의도만 새 키를 발급한다', async () => {
  const f = await commerceFixture();
  const input = { name: 'quote_market_purchase', args: { cardVariantId: randomUUID(), maxPrice: '1000000' } };
  const key = await f.policies.actionKey(buyer, f.run.id, 'market-search-1', input);
  const restarted = createPolicyService({ store: f.store });
  expect(await restarted.actionKey(buyer, f.run.id, 'market-search-1', input)).toBe(key);
  await expect(restarted.actionKey(buyer, f.run.id, 'market-search-1', { ...input, args: {} })).rejects.toMatchObject({ code: 'IDEMPOTENCY_CONFLICT' });
  expect(await restarted.actionKey(buyer, f.run.id, 'market-search-2', input)).not.toBe(key);
});
