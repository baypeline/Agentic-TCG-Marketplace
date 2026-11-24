import { expect, it } from 'vitest';
import { describePurchase } from '../src/lib/purchase-status';
import { purchaseStatusSchema } from '@tcg/contracts';
const expiresAt = '2026-11-24T00:02:00.000Z';
const base = purchaseStatusSchema.parse({ id: '00000000-0000-4000-8000-000000000001', policyId: null, policyVersion: null, paymentAttemptId: null, quoteStatus: 'RESERVED', amount: '7000000', paymentStatus: null, tradeStatus: 'NOT_STARTED', holdReasons: [], expiresAt, remainingMs: 120000, transactionHash: null, needsReview: false, retryPaymentAllowed: true });
it('보류 사유와 원래 만료 시간을 표시하고 시간이 끝나면 예약 만료로 안내한다', () => {
  expect(describePurchase({ ...base, holdReasons: ['건당 상한 초과'] }, 60000)).toMatchObject({ title: '결제 보류' });
  expect(describePurchase({ ...base, holdReasons: ['건당 상한 초과'] }, 60000).detail).toContain('60초');
  expect(describePurchase(base, 120000).title).toBe('예약 만료');
});
it('UNKNOWN과 정산 후 체결 지연은 예약 만료나 재결제를 안내하지 않는다', () => {
  expect(describePurchase({ ...base, paymentStatus: 'UNKNOWN', needsReview: true }, 999999).title).toBe('결제 확인 중');
  const finalizing = describePurchase({ ...base, paymentStatus: 'SETTLED', tradeStatus: 'FINALIZING' }, 999999);
  expect(finalizing.title).toBe('결제 완료 · 거래 처리 중'); expect(finalizing.detail).toContain('추가 결제 없이');
  expect(describePurchase({ ...base, paymentStatus: 'SETTLED', tradeStatus: 'COMPLETED' }, 0).title).toBe('구매 완료');
});
it('명시적 해제는 시간이 남아도 결제 대기로 표시하지 않는다', () => {
  expect(describePurchase({ ...base, quoteStatus: 'RELEASED' }, 0).title).toBe('예약 해제');
});

it('브라우저 절대 시각 대신 서버 잔여 시간으로 카운트다운한다', () => {
  expect(describePurchase({ ...base, expiresAt: '2000-01-01T00:00:00.000Z' }, 30000).detail).toContain('90초');
});
