import { renderUI } from './render';
import { expect, it } from 'vitest';
import { MarketPrices } from '../src/components/market-prices';
it('원본 통화와 가격 유형 및 검증 상태를 표시하고 USDC로 단정하지 않는다', () => {
  const html = renderUI(<MarketPrices prices={{ cardVariantId: '00000000-0000-4000-8000-000000000001', dataSource: 'MARKET', maxAgeHours: 72, evaluatedAt: '2026-11-22T00:00:00Z', items: [{ id: '00000000-0000-4000-8000-000000000002', provider: 'CARDMARKET', providerVariant: 'normal', priceType: 'ASKING_LOW', originalCurrency: 'EUR', originalAmount: '0.08', sourceUrl: 'https://example.test/card', observedAt: '2026-11-21T00:00:00Z', collectedAt: '2026-11-22T00:00:00Z', eligibility: 'UNSUPPORTED_PRICE_TYPE' }] }} />);
  expect(html).toContain('0.08 EUR');
  expect(html).toContain('최저 판매 희망가');
  expect(html).toContain('참고 전용 가격 유형');
  expect(html).toContain('한국어판 실거래가가 아닙니다');
  expect(html).not.toContain('0.08 USDC');
});
