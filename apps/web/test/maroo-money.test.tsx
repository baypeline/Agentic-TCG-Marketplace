import { expect, it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { formatUsdc } from '../src/lib/formatters';
import { parseUsdcInput, usdcDecimal } from '../src/features/trading/demo-model';
import { PurchaseOffers, PurchaseReceipt } from '../src/features/chat/purchase-offers';
import { renderUI } from './render';

it('18자리 tOKRW 입력과 표시가 소수 정밀도를 잃지 않는다', () => {
  expect(parseUsdcInput('5.000000000000000001', 'tOKRW')).toBe('5000000000000000001');
  expect(usdcDecimal('5000000000000000001', 'tOKRW')).toBe('5.000000000000000001');
  expect(formatUsdc('5000000000000000000', 'tOKRW')).toBe('5 tOKRW');
  expect(parseUsdcInput('0.0000000000000000001', 'tOKRW')).toBeNull();
  expect(parseUsdcInput('0.0000001')).toBeNull();
});
it('마루 구매 버튼과 영수증이 tOKRW·가스 부담·마루 탐색기를 표시한다', () => {
  const offer = { listingId: '00000000-0000-4000-8000-000000000001', card: demoCards[0]!, price: '5000000000000000000', dataSource: 'SYNTHETIC_DEMO' as const, paymentMode: 'X402_MAROO_NATIVE' as const, paymentReady: true, currency: 'tOKRW' as const };
  const html = renderUI(<PurchaseOffers offers={[offer]} disabled={false} completedIds={[]} submittedIds={[]} signingMode="server" onBuy={() => undefined} />);
  expect(html).toContain('5 tOKRW'); expect(html).toContain('25 tOKRW'); expect(html).toContain('가스비');
  expect(html).not.toContain('USDC');
  const receipt = renderUI(<PurchaseReceipt progress={{ requestId: offer.listingId, listingId: offer.listingId, card: offer.card, amount: offer.price, matchQuoteId: offer.listingId, status: 'COMPLETED', paymentMode: offer.paymentMode, currency: 'tOKRW', expiresAt: '2099-01-01T00:00:00.000Z', payer: `0x${'1'.repeat(40)}`, recipient: `0x${'2'.repeat(40)}`, transactionHash: `0x${'a'.repeat(64)}` }} disabled={false} onCheck={() => undefined} />);
  expect(receipt).toContain('https://explorer-testnet.maroo.io/tx/'); expect(receipt).toContain('5 tOKRW'); expect(receipt).not.toContain('basescan');
});
