import { expect, it } from 'vitest';
import type { MarketPrice, MarketPricesResponse, Valuation } from '@tcg/contracts';
import { getValuationStatus } from '../src/lib/valuation-status';

const valuation: Valuation = { cardVariantId: '00000000-0000-4000-8000-000000000001', currency: 'USDC', dataSource: 'MARKET', confidence: 'LOW', evaluatedAt: '2026-11-24T00:00:00Z', status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0 };
const row: MarketPrice = { id: '00000000-0000-4000-8000-000000000002', provider: 'CARDMARKET', providerVariant: 'normal', priceType: 'PROVIDER_AVERAGE', originalAmount: '12', originalCurrency: 'EUR', sourceUrl: 'https://example.test/prices', observedAt: valuation.evaluatedAt, collectedAt: valuation.evaluatedAt, eligibility: 'STALE_PRICE' };
const prices: MarketPricesResponse = { cardVariantId: valuation.cardVariantId, dataSource: 'MARKET', maxAgeHours: 72, evaluatedAt: valuation.evaluatedAt, items: [row] };

it.each([
  ['STALE_PRICE', '가격의 유효기간'],
  ['STALE_FX', 'USDC 환율 근거의 유효기간'],
  ['VARIANT_MISMATCH', '이 카드와 일치하지'],
  ['UNSUPPORTED_PRICE_TYPE', '적정가 계산에 사용하지'],
] as const)('%s의 제외 사유를 표시하고 중복 가격 유형을 한 번만 설명한다', (eligibility, text) => {
  const status = getValuationStatus(valuation, { ...prices, items: [{ ...row, eligibility }, { ...row, eligibility }] });
  expect(status?.reasons).toHaveLength(1);
  expect(status?.reasons[0]).toContain(text);
});

it('다른 카드의 가격이나 Mock 표본을 현재 카드의 시장 검증 근거로 사용하지 않는다', () => {
  expect(getValuationStatus(valuation, { ...prices, cardVariantId: row.id })?.reasons[0]).toContain('확인하지 못했어요');
  expect(getValuationStatus({ ...valuation, dataSource: 'MOCK' }, prices)?.title).toBe('가격 표본이 없어요');
});
