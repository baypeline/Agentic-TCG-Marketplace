import { expect, it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { PurchaseOffers, PurchaseReceipt } from '../src/features/chat/purchase-offers';
import { renderUI } from './render';

const offer = { listingId: '00000000-0000-4000-8200-000000000001', card: demoCards[0]!, price: '10000', dataSource: 'SYNTHETIC_DEMO' as const, paymentMode: 'X402_BASE_SEPOLIA' as const, paymentReady: true };
it('합성 매물과 실제 테스트넷 결제를 구분하고 서명 전 금액을 표시한다', () => {
  const html = renderUI(<PurchaseOffers offers={[offer]} disabled={false} completedIds={[]} submittedIds={[]} onBuy={() => undefined} />);
  expect(html).toContain('0.01 USDC'); expect(html).toContain('테스트 USDC가 실제 전송'); expect(html).toContain('지갑으로 구매');
  const retry = renderUI(<PurchaseOffers offers={[offer]} disabled={false} completedIds={[]} submittedIds={[offer.listingId]} onBuy={() => undefined} />);
  expect(retry).toContain('기존 결제 확인'); expect(retry).not.toContain('지갑으로 구매');
});
it('체결 완료 영수증에 내 카드·거래 내역·검증된 해시 링크를 제공한다', () => {
  const html = renderUI(<PurchaseReceipt progress={{ requestId: '00000000-0000-4000-8200-000000000002', listingId: offer.listingId, card: offer.card, amount: offer.price, matchQuoteId: '00000000-0000-4000-8200-000000000003', status: 'COMPLETED', paymentMode: 'X402_BASE_SEPOLIA', expiresAt: '2099-01-01T00:00:00Z', payer: `0x${'1'.repeat(40)}`, recipient: `0x${'2'.repeat(40)}`, transactionHash: `0x${'a'.repeat(64)}` }} disabled={false} onCheck={() => undefined} />);
  expect(html).toContain('구매가 완료됐어요'); expect(html).toContain('href="/collection"'); expect(html).toContain('href="/activity"'); expect(html).toContain(`https://sepolia.basescan.org/tx/0x${'a'.repeat(64)}`);
});
