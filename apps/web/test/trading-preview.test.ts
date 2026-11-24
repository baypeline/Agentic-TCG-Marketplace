import { expect, it } from 'vitest';
import { buyOrderSchema, inventoryItemSchema, listingSchema, spendingPolicySchema, tradeSchema, cardVariantSchema } from '@tcg/contracts';
import { budgetSummary, demoId, demoReducer, initialDemoState, parseUsdcInput, policyToDraft, validatePolicy } from '../src/features/trading/demo-model';
import { previewCards } from '../src/features/trading/demo-cards';

const event = { at: '2026-11-22T05:00:00Z', logId: demoId(999) };
it('예시 데이터가 기존 공통 계약과 맞고 카드 참조를 유지한다', () => {
  const state = initialDemoState();
  for (const card of previewCards) expect(cardVariantSchema.safeParse(card).success).toBe(true);
  expect(spendingPolicySchema.safeParse(state.policy).success).toBe(true);
  for (const row of state.inventory) expect(inventoryItemSchema.safeParse(row).success).toBe(true);
  for (const row of state.listings) expect(listingSchema.safeParse(row).success).toBe(true);
  for (const row of state.orders) expect(buyOrderSchema.safeParse(row).success).toBe(true);
  for (const row of state.trades) expect(tradeSchema.safeParse(row).success).toBe(true);
  const ids = new Set(previewCards.map(card => card.id));
  expect([...state.inventory, ...state.orders, ...state.payments].every(row => ids.has(row.cardVariantId))).toBe(true);
});
it('USDC 입력은 최소 단위를 보존하고 잘못된 금액을 거절한다', () => {
  expect(parseUsdcInput('0.000001')).toBe('1');
  expect(parseUsdcInput('123.456789')).toBe('123456789');
  for (const value of ['0', '-1', '1e3', '0.0000001', '', '1000000000']) expect(parseUsdcInput(value)).toBeNull();
});
it('예산 한도와 허용 카드 및 유효 날짜 오류를 함께 보여준다', () => {
  const draft = { ...policyToDraft(initialDemoState().policy), totalBudget: '5', maxPerTrade: '6', minDiscountPercent: '101', allowedCardVariantIds: [], validUntil: '2026-02-31' };
  const errors = validatePolicy(draft, Date.parse('2026-01-01T00:00:00Z'));
  expect(Object.keys(errors).sort()).toEqual(['allowedCardVariantIds', 'maxPerTrade', 'minDiscountPercent', 'validUntil']);
});
it('입금과 실패 결제를 제외하고 확인 중인 지출은 예약 예산에 포함한다', () => {
  expect(budgetSummary(initialDemoState())).toMatchObject({ spent: '22000000', reserved: '27000000', remaining: '251000000' });
  expect(initialDemoState().payments.find(row => row.id === demoId(403))?.status).toBe('UNKNOWN');
});
it('매물 등록과 취소를 보유 목록에 함께 반영하고 중복 등록과 예약 취소를 막는다', () => {
  const initial = initialDemoState();
  const listed = demoReducer(initial, { type: 'LIST', inventoryId: demoId(101), amount: '13000000', id: demoId(299), ...event });
  expect(listed.inventory.find(row => row.id === demoId(101))?.status).toBe('LISTED');
  expect(listed.listings.find(row => row.id === demoId(299))?.price).toBe('13000000');
  expect(demoReducer(listed, { type: 'LIST', inventoryId: demoId(101), amount: '1', id: demoId(298), ...event })).toBe(listed);
  const cancelled = demoReducer(listed, { type: 'CANCEL_LISTING', id: demoId(299), ...event });
  expect(cancelled.inventory.find(row => row.id === demoId(101))?.status).toBe('AVAILABLE');
  expect(demoReducer(initial, { type: 'CANCEL_LISTING', id: demoId(206), ...event })).toBe(initial);
});

it('정책 수정은 ID와 누적 사용액을 유지하고 사용·예약액 미만 감액을 거부한다', () => {
  const state = initialDemoState();
  const updated = demoReducer(state, { type: 'POLICY', policy: { ...state.policy, maxPerTrade: '10000000' }, ...event });
  expect(updated.policy.id).toBe(state.policy.id);
  expect(updated.policy.version).toBe(state.policy.version + 1);
  expect(budgetSummary(updated)).toEqual(budgetSummary(state));
  expect(demoReducer(state, { type: 'POLICY', policy: { ...state.policy, totalBudget: '1' }, ...event })).toBe(state);
});
