import { renderUI } from './render';
import { expect, it } from 'vitest';
import type { Valuation } from '@tcg/contracts';
import { ValuationDetails } from '../src/components/valuation-details';

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
