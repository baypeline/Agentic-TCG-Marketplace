import { describe, expect, it } from 'vitest';
import { amountSchema, idSchema, valuationSchema } from '../src/index.js';

describe('공통 계약', () => {
  it('부동소수점·음수·지수 표기 가격을 거부한다', () => {
    for (const amount of ['1.5', '-1', '1e6', '01', '']) expect(amountSchema.safeParse(amount).success).toBe(false);
    expect(amountSchema.parse('9007199254740993000000')).toBe('9007199254740993000000');
  });
  it('예시용 문자열 ID 대신 UUID를 강제한다', () => {
    expect(idSchema.safeParse('card-001').success).toBe(false);
  });
  it('가격 부족 상태에 숫자 가격을 넣을 수 없다', () => {
    expect(valuationSchema.safeParse({ cardVariantId: '00000000-0000-4000-8000-000000000001', status: 'INSUFFICIENT_DATA', estimatedPrice: '0', currency: 'USDC', sampleSize: 0, confidence: 'LOW', dataSource: 'MARKET', evaluatedAt: new Date().toISOString() }).success).toBe(false);
  });
  it('가격이 있는 평가에는 표본과 출처가 필요하다', () => {
    const value = { cardVariantId: '00000000-0000-4000-8000-000000000001', status: 'AVAILABLE', estimatedPrice: '1000000', currency: 'USDC', sampleSize: 1, confidence: 'LOW', dataSource: 'MOCK', evaluatedAt: '2026-11-20T00:00:00.000Z', sourceSummary: ['demo'] };
    expect(valuationSchema.safeParse(value).success).toBe(true);
    expect(valuationSchema.safeParse({ ...value, sampleSize: 0 }).success).toBe(false);
    expect(valuationSchema.safeParse({ ...value, sourceSummary: [] }).success).toBe(false);
    expect(valuationSchema.safeParse({ ...value, evaluatedAt: 'invalid' }).success).toBe(false);
    expect(valuationSchema.safeParse({ ...value, status: 'INSUFFICIENT_DATA', estimatedPrice: null }).success).toBe(false);
  });
});
