import { renderUI } from './render';
import { expect, it } from 'vitest';
import type { Valuation } from '@tcg/contracts';
import { ValuationDetails } from '../src/components/valuation-details';
import type { MarketPricesResponse } from '@tcg/contracts';
import { demoCards } from '@tcg/contracts/fixtures';

const base = { cardVariantId: '00000000-0000-4000-8000-000000000001', currency: 'USDC', dataSource: 'MOCK', confidence: 'LOW', evaluatedAt: '2026-11-22T00:00:00.000Z', sourceSummary: ['시연용 합성 표본'] } as const;
it('상세 가격에 Mock 경고와 출처·표본·평가 시각을 표시한다', () => {
  const valuation: Valuation = { ...base, sourceSummary: [...base.sourceSummary], status: 'AVAILABLE', estimatedPrice: '12500000', sampleSize: 3 };
  const html = renderUI(<ValuationDetails valuation={valuation} />);
  expect(html).toContain('12.5 USDC');
  expect(html).toContain('Mock / 합성 데이터');
  expect(html).toContain('실제 시장가격이나 구매 판단에 사용할 수 없습니다.');
  expect(html).toContain('시연용 합성 표본');
  expect(html).toContain('3개');
  expect(html).toContain('dateTime="2026-11-22T00:00:00.000Z"');
});
it('가격 부재를 0 USDC로 표시하지 않는다', () => {
  const html = renderUI(<ValuationDetails valuation={{ ...base, sourceSummary: [...base.sourceSummary], status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0 }} />);
  expect(html).toContain('평가 자료 부족');
  expect(html).not.toContain('0 USDC');
});

const market: Valuation = { ...base, dataSource: 'MARKET', status: 'INSUFFICIENT_DATA', estimatedPrice: null, sampleSize: 0, methodology: 'MEDIAN_OF_PROVIDER_AGGREGATES', sourceSummary: [] };
const prices: MarketPricesResponse = { cardVariantId: base.cardVariantId, dataSource: 'MARKET', maxAgeHours: 72, evaluatedAt: base.evaluatedAt, items: [{
  id: '00000000-0000-4000-8000-000000000002', provider: 'TCGPLAYER', providerVariant: 'normal', priceType: 'PROVIDER_MARKET', originalAmount: '12.5', originalCurrency: 'USD', sourceUrl: 'https://example.test/prices', observedAt: base.evaluatedAt, collectedAt: base.evaluatedAt, eligibility: 'UNVERIFIED_VARIANT',
}] };

it('수집된 가격이 있어도 미확정 속성과 검증 부족을 설명하고 가격을 만들어내지 않는다', () => {
  const html = renderUI(<ValuationDetails valuation={market} prices={prices} card={{ ...demoCards[0]!, edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' }} />);
  expect(html).toContain('참고 시세만 확인할 수 있어요');
  expect(html).toContain('에디션·보존 상태가 미확정');
  expect(html).toContain('USDC 환율 근거가 확인되지');
  expect(html).toContain('href="#market-data"');
  expect(html).not.toContain('12.5 USDC');
});

it('수집 자료 없음과 참고 시세 조회 실패를 구분한다', () => {
  const missing = renderUI(<ValuationDetails valuation={market} prices={{ ...prices, items: [] }} />);
  expect(missing).toContain('수집된 가격이 없어요');
  const failed = renderUI(<ValuationDetails valuation={market} prices={null} />);
  expect(failed).toContain('수집·검증 상태를 확인하지 못했어요');
  expect(failed).not.toContain('수집된 가격이 없어요');
});

it('정상 평가에서 제공자 표본의 의미와 관측 범위를 표시한다', () => {
  const html = renderUI(<ValuationDetails valuation={{ ...market, status: 'AVAILABLE', estimatedPrice: '12500000', sampleSize: 1, sourceSummary: ['TCGPLAYER:normal'], oldestObservedAt: '2026-11-21T00:00:00Z', latestObservedAt: base.evaluatedAt }} />);
  expect(html).toContain('12.5 USDC');
  expect(html).toContain('평가 제공자 수');
  expect(html).toContain('검증된 제공자 집계가의 중앙값');
  expect(html).toContain('dateTime="2026-11-21T00:00:00Z"');
  expect(html).toContain('실제 체결 건수가 아닙니다');
  expect(html).not.toContain('참고 시세만 확인할 수 있어요');
});

it('실제 USD 데모 환산을 합성 데이터나 검증 적정가로 표시하지 않는다', () => {
  const html = renderUI(<ValuationDetails valuation={{ ...market, status: 'AVAILABLE', estimatedPrice: '12500000', sampleSize: 1, sourceSummary: ['TCGPLAYER:normal'], methodology: 'DEMO_USD_REFERENCE', assumptions: ['1 USD ≈ 1 USDC 데모 환산', '판본·보존 상태 미보정'] }} />);
  expect(html).toContain('12.5 USDC');
  expect(html).toContain('데모 참고 추정가');
  expect(html).toContain('판본·보존 상태 미보정');
  expect(html).not.toContain('Mock / 합성 데이터');
  expect(html).not.toContain('검증된 제공자 집계가의 중앙값');
});
