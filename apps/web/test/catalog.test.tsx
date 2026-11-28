import { expect, it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import type { CatalogItem } from '../src/lib/formatters';
import { CatalogView } from '../src/features/catalog/catalog-view';
import { renderUI } from './render';

const card = demoCards[0]!;
const base: CatalogItem = { card, valuation: null, prices: null, valuationFailed: false, pricesFailed: false };
it('검색어를 상세 링크에 보존하고 가격 조회 실패를 자료 부족과 구분한다', () => {
  const html = renderUI(<CatalogView query="피카츄" items={[{ ...base, valuationFailed: true }]} />);
  expect(html).toContain(`/cards/${card.id}?q=%ED%94%BC%EC%B9%B4%EC%B8%84`);
  expect(html).toContain('가격 조회 실패');
  expect(html).not.toContain('평가 자료 부족');
});
it('참고 가격과 외부 원본 통화를 구분하고 반복 데이터 배지를 표시하지 않는다', () => {
  const demo: CatalogItem = { ...base, valuation: { cardVariantId: card.id, currency: 'USDC', dataSource: 'MOCK', status: 'AVAILABLE', estimatedPrice: '12500000', sampleSize: 1, confidence: 'LOW', evaluatedAt: '2026-11-22T00:00:00Z', sourceSummary: ['test mock'] } };
  const html = renderUI(<CatalogView query="" items={[demo]} />);
  expect(html).toContain('참고 가격'); expect(html).toContain('12.5 USDC'); expect(html).not.toContain('합성 데이터');
  const market: CatalogItem = { ...base, prices: { cardVariantId: card.id, dataSource: 'MARKET', maxAgeHours: 72, evaluatedAt: '2026-11-22T00:00:00Z', items: [{ id: '00000000-0000-4000-8000-000000000002', provider: 'CARDMARKET', providerVariant: 'normal', priceType: 'PROVIDER_AVERAGE', originalCurrency: 'EUR', originalAmount: '4.2', sourceUrl: 'https://example.test/pricing', observedAt: '2026-11-21T00:00:00Z', collectedAt: '2026-11-22T00:00:00Z', eligibility: 'UNVERIFIED_VARIANT' }] } };
  const reference = renderUI(<CatalogView query="" items={[market]} />);
  expect(reference).toContain('4.2 EUR'); expect(reference).toContain('판본·환율 검증 필요'); expect(reference).not.toContain('4.2 USDC');
});
