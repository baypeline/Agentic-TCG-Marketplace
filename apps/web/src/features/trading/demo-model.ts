import type { Currency } from '@tcg/contracts/payment-profile';
import type { BuyOrder, InventoryItem, Listing, SpendingPolicy, Trade } from '@tcg/contracts';
import { previewCards } from './demo-cards';

export const demoId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;
export const demoUserId = demoId(1);
export const demoAgentId = demoId(2);
export type PaymentStatus = 'PENDING' | 'SETTLED' | 'FAILED' | 'UNKNOWN';
export interface PreviewPayment { id: string; orderId: string; cardVariantId: string; amount: string; status: PaymentStatus; direction: 'IN' | 'OUT'; updatedAt: string }
export interface PreviewTrade extends Trade { cardVariantId: string; direction: 'BUY' | 'SELL' }
export interface PreviewLog { id: string; level: 'INFO' | 'WARN' | 'ERROR'; event: string; message: string; at: string; referenceId?: string }
export interface DemoState { policy: SpendingPolicy; run: 'IDLE' | 'RUNNING' | 'PAUSED'; inventory: InventoryItem[]; listings: Listing[]; orders: BuyOrder[]; payments: PreviewPayment[]; trades: PreviewTrade[]; logs: PreviewLog[] }
export interface PolicyDraft { enabled: boolean; totalBudget: string; maxPerTrade: string; minDiscountPercent: string; validUntil: string; allowedCardVariantIds: string[] }

export function parseUsdcInput(value: string, currency: Currency = 'USDC'): string | null {
  const decimals = currency === 'tOKRW' ? 18 : 6;
  if (!new RegExp(`^\\d{1,9}(\\.\\d{1,${decimals}})?$`).test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const amount = BigInt(whole!) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0'));
  return amount > 0n ? amount.toString() : null;
}
export function usdcDecimal(amount: string, currency: Currency = 'USDC') { const n = BigInt(amount), decimals = currency === 'tOKRW' ? 18 : 6, scale = 10n ** BigInt(decimals); const fraction = (n % scale).toString().padStart(decimals, '0').replace(/0+$/, ''); return `${n / scale}${fraction ? `.${fraction}` : ''}`; }
export function policyToDraft(policy: SpendingPolicy): PolicyDraft { return { enabled: policy.enabled, totalBudget: usdcDecimal(policy.totalBudget), maxPerTrade: usdcDecimal(policy.maxPerTrade), minDiscountPercent: String(policy.minDiscountPercent ?? 0), validUntil: policy.validUntil.slice(0, 10), allowedCardVariantIds: [...(policy.allowedCardVariantIds ?? [])] }; }
export function validatePolicy(draft: PolicyDraft, now = Date.now()): Partial<Record<keyof PolicyDraft, string>> {
  const errors: Partial<Record<keyof PolicyDraft, string>> = {};
  const total = parseUsdcInput(draft.totalBudget), per = parseUsdcInput(draft.maxPerTrade);
  if (!total) errors.totalBudget = '0보다 큰 금액을 소수점 6자리 이내로 입력해 주세요.';
  if (!per) errors.maxPerTrade = '0보다 큰 금액을 소수점 6자리 이내로 입력해 주세요.';
  else if (total && BigInt(per) > BigInt(total)) errors.maxPerTrade = '1회 거래 한도는 총예산보다 클 수 없어요.';
  if (!draft.minDiscountPercent.trim() || !Number.isFinite(Number(draft.minDiscountPercent)) || Number(draft.minDiscountPercent) < 0 || Number(draft.minDiscountPercent) > 100) errors.minDiscountPercent = '0부터 100 사이의 비율을 입력해 주세요.';
  const until = Date.parse(`${draft.validUntil}T23:59:59Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.validUntil) || !Number.isFinite(until) || new Date(until).toISOString().slice(0, 10) !== draft.validUntil || until <= now) errors.validUntil = '오늘 이후의 유효 날짜를 선택해 주세요.';
  if (!draft.allowedCardVariantIds.length) errors.allowedCardVariantIds = '거래를 허용할 카드를 하나 이상 선택해 주세요.';
  return errors;
}
export function draftToPolicy(draft: PolicyDraft): SpendingPolicy { return { id: '00000000-0000-4000-8004-000000000001', version: 1, agentId: demoAgentId, enabled: draft.enabled, totalBudget: parseUsdcInput(draft.totalBudget)!, maxPerTrade: parseUsdcInput(draft.maxPerTrade)!, minDiscountPercent: Number(draft.minDiscountPercent), allowedCardVariantIds: [...draft.allowedCardVariantIds], validUntil: `${draft.validUntil}T23:59:59Z` }; }
export function budgetSummary(state: DemoState) {
  const outgoing = state.payments.filter(p => p.direction === 'OUT');
  const spent = outgoing.filter(p => p.status === 'SETTLED').reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const reserved = outgoing.filter(p => p.status === 'PENDING' || p.status === 'UNKNOWN').reduce((sum, p) => sum + BigInt(p.amount), 0n);
  const remaining = BigInt(state.policy.totalBudget) - spent - reserved;
  return { spent: spent.toString(), reserved: reserved.toString(), remaining: (remaining < 0n ? 0n : remaining).toString(), exceeded: remaining < 0n };
}

export function initialDemoState(): DemoState {
  const [pika, charizard, eevee] = previewCards.map(card => card.id) as [string, string, string];
  const at = '2026-11-22T04:00:00Z';
  return {
    policy: { id: '00000000-0000-4000-8004-000000000001', version: 1, agentId: demoAgentId, enabled: true, totalBudget: '300000000', maxPerTrade: '75000000', minDiscountPercent: 5, allowedCardVariantIds: [pika, charizard, eevee], validUntil: '2026-12-31T23:59:59Z' }, run: 'IDLE',
    inventory: [
      { id: demoId(101), ownerId: demoUserId, cardVariantId: pika, status: 'AVAILABLE' },
      { id: demoId(102), ownerId: demoUserId, cardVariantId: charizard, status: 'LISTED' },
      { id: demoId(103), ownerId: demoUserId, cardVariantId: eevee, status: 'RESERVED' },
    ],
    listings: [
      { id: demoId(201), inventoryItemId: demoId(111), cardVariantId: eevee, sellerId: demoId(3), price: '12000000', status: 'ACTIVE', createdAt: at },
      { id: demoId(202), inventoryItemId: demoId(112), cardVariantId: charizard, sellerId: demoId(4), price: '50000000', status: 'ACTIVE', createdAt: at },
      { id: demoId(203), inventoryItemId: demoId(113), cardVariantId: pika, sellerId: demoId(3), price: '15000000', status: 'RESERVED', createdAt: at },
      { id: demoId(204), inventoryItemId: demoId(114), cardVariantId: pika, sellerId: demoId(4), price: '22000000', status: 'SOLD', createdAt: at },
      { id: demoId(205), inventoryItemId: demoId(102), cardVariantId: charizard, sellerId: demoUserId, price: '60000000', status: 'ACTIVE', createdAt: at },
      { id: demoId(206), inventoryItemId: demoId(103), cardVariantId: eevee, sellerId: demoUserId, price: '11000000', status: 'RESERVED', createdAt: at },
    ],
    orders: [
      { id: demoId(301), agentId: demoAgentId, cardVariantId: pika, maxPrice: '15000000', status: 'ACTIVE', createdAt: at, expiresAt: '2026-12-31T23:59:59Z' },
      { id: demoId(302), agentId: demoAgentId, cardVariantId: charizard, maxPrice: '75000000', status: 'PAUSED', createdAt: at, expiresAt: '2026-12-31T23:59:59Z' },
      { id: demoId(303), agentId: demoAgentId, cardVariantId: eevee, maxPrice: '12000000', status: 'MATCH_PENDING', createdAt: at, expiresAt: '2026-12-31T23:59:59Z' },
      { id: demoId(304), agentId: demoAgentId, cardVariantId: pika, maxPrice: '22000000', status: 'FILLED', createdAt: at, expiresAt: '2026-12-31T23:59:59Z' },
    ],
    payments: [
      { id: demoId(401), orderId: demoId(304), cardVariantId: pika, amount: '22000000', direction: 'OUT', status: 'SETTLED', updatedAt: at },
      { id: demoId(402), orderId: demoId(302), cardVariantId: charizard, amount: '50000000', direction: 'OUT', status: 'FAILED', updatedAt: at },
      { id: demoId(403), orderId: demoId(301), cardVariantId: pika, amount: '15000000', direction: 'OUT', status: 'UNKNOWN', updatedAt: at },
      { id: demoId(404), orderId: demoId(303), cardVariantId: eevee, amount: '12000000', direction: 'OUT', status: 'PENDING', updatedAt: at },
    ],
    trades: [
      { id: demoId(501), matchQuoteId: demoId(601), buyerId: demoUserId, sellerId: demoId(4), inventoryItemId: demoId(101), price: '22000000', paymentAttemptId: demoId(401), status: 'COMPLETED', completedAt: at, cardVariantId: pika, direction: 'BUY' },
      { id: demoId(502), matchQuoteId: demoId(602), buyerId: demoId(3), sellerId: demoUserId, inventoryItemId: demoId(104), price: '11000000', paymentAttemptId: demoId(405), status: 'COMPLETED', completedAt: at, cardVariantId: pika, direction: 'SELL' },
    ],
    logs: [
      { id: demoId(701), level: 'ERROR', event: 'PAYMENT_FAILED', message: '결제 실패 상태를 보여주는 예시예요. 실제 결제를 요청하지 않았어요.', at, referenceId: demoId(402) },
      { id: demoId(702), level: 'WARN', event: 'PAYMENT_UNKNOWN', message: '결과를 확인하지 못한 상태예요. 중복 결제 없이 확인을 기다리는 화면 예시입니다.', at, referenceId: demoId(403) },
      { id: demoId(703), level: 'INFO', event: 'TRADE_COMPLETED', message: '카드 인수와 거래 완료 상태를 보여주는 예시 기록이에요.', at, referenceId: demoId(501) },
    ],
  };
}

export type DemoAction =
  | { type: 'POLICY'; policy: SpendingPolicy }
  | { type: 'RUN'; run: DemoState['run'] }
  | { type: 'ORDER'; id: string; status: BuyOrder['status'] }
  | { type: 'CREATE_ORDER'; cardId: string; amount: string; id: string }
  | { type: 'LIST'; inventoryId: string; amount: string; id: string }
  | { type: 'CANCEL_LISTING'; id: string }
export function demoReducer(state: DemoState, action: DemoAction & { at: string; logId: string }): DemoState {
  let next = state;
  switch (action.type) {
    case 'POLICY': if (BigInt(action.policy.totalBudget) < BigInt(budgetSummary(state).spent) + BigInt(budgetSummary(state).reserved)) return state; next = { ...state, policy: { ...action.policy, id: state.policy.id, version: state.policy.version + 1 }, run: action.policy.enabled ? state.run : 'PAUSED' }; break;
    case 'RUN': next = { ...state, run: action.run }; break;
    case 'ORDER': next = { ...state, orders: state.orders.map(row => row.id === action.id ? { ...row, status: action.status } : row) }; break;
    case 'CREATE_ORDER': next = { ...state, orders: [{ id: action.id, agentId: demoAgentId, cardVariantId: action.cardId, maxPrice: action.amount, status: 'ACTIVE', createdAt: action.at, expiresAt: state.policy.validUntil }, ...state.orders] }; break;
    case 'LIST': {
      const item = state.inventory.find(row => row.id === action.inventoryId && row.status === 'AVAILABLE');
      if (!item) return state;
      next = { ...state, inventory: state.inventory.map(row => row.id === item.id ? { ...row, status: 'LISTED' } : row), listings: [{ id: action.id, inventoryItemId: item.id, cardVariantId: item.cardVariantId, sellerId: demoUserId, price: action.amount, status: 'ACTIVE', createdAt: action.at }, ...state.listings] }; break;
    }
    case 'CANCEL_LISTING': {
      const listing = state.listings.find(row => row.id === action.id && row.sellerId === demoUserId && row.status === 'ACTIVE');
      if (!listing) return state;
      next = { ...state, listings: state.listings.map(row => row.id === listing.id ? { ...row, status: 'CANCELLED' } : row), inventory: state.inventory.map(row => row.id === listing.inventoryItemId ? { ...row, status: 'AVAILABLE' } : row) }; break;
    }
  }
  return { ...next, logs: [{ id: action.logId, level: 'INFO', event: `UI_DEMO_${action.type}`, message: '미리보기 화면의 상태를 변경했어요. 서버 요청이나 실제 거래는 실행되지 않았어요.', at: action.at, referenceId: 'id' in action ? action.id : undefined }, ...next.logs] };
}
