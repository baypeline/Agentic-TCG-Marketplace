import { expect, it } from 'vitest';
import { agentPaymentRequirementsSchema } from '../src/index.js';
import { formatMoney, getPaymentProfile } from '../src/payment-profile.js';

it('USDC 6자리와 tOKRW 18자리 단위를 독립적으로 표시한다', () => {
  expect(formatMoney('10000')).toBe('0.01 USDC');
  expect(formatMoney('5000000000000000000', 'tOKRW')).toBe('5 tOKRW');
  expect(formatMoney('1', 'tOKRW')).toBe('0.000000000000000001 tOKRW');
  expect(getPaymentProfile('maroo').chainId).toBe(450815);
});
it('마루와 Base의 결제 요구를 섞거나 주문 유효기간을 생략하면 거부한다', () => {
  const profile = getPaymentProfile('maroo');
  const req = { ...profile, amount: '5000000000000000000', payTo: `0x${'2'.repeat(40)}`, maxTimeoutSeconds: 60, extra: { tcgQuoteId: '00000000-0000-4000-8000-000000000001', expiresAt: '2099-01-01T00:00:00.000Z' } };
  expect(agentPaymentRequirementsSchema.safeParse(req).success).toBe(true);
  expect(agentPaymentRequirementsSchema.safeParse({ ...req, network: 'eip155:84532' }).success).toBe(false);
  expect(agentPaymentRequirementsSchema.safeParse({ ...req, extra: {} }).success).toBe(false);
});
