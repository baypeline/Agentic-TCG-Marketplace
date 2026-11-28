import { expect, it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { PurchaseOffers, PurchaseReceipt } from '../src/features/chat/purchase-offers';
import { renderUI } from './render';
import { agentBudgetStateSchema } from '@tcg/contracts';

it('실제 한도와 남은 예산을 표시하고 부족할 때 설정 경로를 제공한다', () => {
  const id = '00000000-0000-4000-8000-000000000001';
  const budget = agentBudgetStateSchema.parse({ policy: { id, agentId: id, version: 3, enabled: true, totalBudget: '100000', maxPerTrade: '5000', validUntil: '2099-01-01T00:00:00Z' }, budget: { policyId: id, totalBudget: '100000', spentAmount: '0', reservedAmount: '0', availableAmount: '90000' }, currency: 'USDC', signerMaxPerTrade: '25000' });
  const props = { offers: [offer], disabled: false, completedIds: [], submittedIds: [], onBuy: () => undefined };
  const html = renderUI(<PurchaseOffers {...props} budget={budget} signingMode="server" />);
  expect(html).toContain('건당 한도 초과'); expect(html).toContain('0.005 USDC'); expect(html).toContain('0.09 USDC'); expect(html).toContain('href="/agent"');
  const pending = renderUI(<PurchaseOffers {...props} budgetUnavailable submittedIds={[offer.listingId]} walletBalance="0" />);
  expect(pending).toContain('기존 결제 확인'); expect(pending).not.toContain('예산 확인 필요');
});

const offer = { listingId: '00000000-0000-4000-8200-000000000001', card: demoCards[0]!, price: '10000', dataSource: 'SYNTHETIC_DEMO' as const, paymentMode: 'X402_BASE_SEPOLIA' as const, paymentReady: true };
it('서버 서명 모드는 전용 지갑과 자동 지급 한도를 구매 전에 표시한다', () => {
  const html = renderUI(<PurchaseOffers offers={[offer]} signingMode="server" payer={`0x${'3'.repeat(40)}`} disabled={false} completedIds={[]} submittedIds={[]} onBuy={() => undefined} />);
  expect(html).toContain('에이전트 지갑으로 구매');
  expect(html).not.toContain('기본 총예산');
  expect(html).toContain('설정한 예산');
  expect(html).toContain('지급 지갑:');
});
it('구매 전 금액과 가스비를 표시하고 반복 데이터 안내를 표시하지 않는다', () => {
  const html = renderUI(<PurchaseOffers offers={[offer]} disabled={false} completedIds={[]} submittedIds={[]} onBuy={() => undefined} />);
  expect(html).toContain('0.01 USDC'); expect(html).toContain('가스비'); expect(html).not.toContain('합성 데모'); expect(html).toContain('지갑으로 구매');
  const retry = renderUI(<PurchaseOffers offers={[offer]} disabled={false} completedIds={[]} submittedIds={[offer.listingId]} onBuy={() => undefined} />);
  expect(retry).toContain('기존 결제 확인'); expect(retry).not.toContain('지갑으로 구매');
});
it('체결 완료 영수증에 내 카드·거래 내역·검증된 해시 링크를 제공한다', () => {
  const html = renderUI(<PurchaseReceipt progress={{ requestId: '00000000-0000-4000-8200-000000000002', listingId: offer.listingId, card: offer.card, amount: offer.price, matchQuoteId: '00000000-0000-4000-8200-000000000003', status: 'COMPLETED', paymentMode: 'X402_BASE_SEPOLIA', expiresAt: '2099-01-01T00:00:00Z', payer: `0x${'1'.repeat(40)}`, recipient: `0x${'2'.repeat(40)}`, transactionHash: `0x${'a'.repeat(64)}` }} disabled={false} onCheck={() => undefined} />);
  expect(html).toContain('구매가 완료됐어요'); expect(html).toContain('href="/collection"'); expect(html).toContain('href="/activity"'); expect(html).toContain(`https://sepolia.basescan.org/tx/0x${'a'.repeat(64)}`);
});
