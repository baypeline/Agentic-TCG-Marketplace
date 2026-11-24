import { expect, it } from 'vitest';
import { selectDemoUsdPrice } from '../src/demo-prices.js';

const at = new Date('2026-11-24T12:00:00Z');
const base = { provider: 'TCGPLAYER', originalCurrency: 'USD', priceType: 'PROVIDER_MARKET', providerVariant: 'normal', originalAmount: '12.345678', observedAt: '2026-11-24T00:00:00Z' };

it('일반판 우선 대표 가격을 고르고 다른 판본 가격과 평균내지 않는다', () => {
  expect(selectDemoUsdPrice([{ ...base, providerVariant: 'holofoil', originalAmount: '999' }, base], at, 72)).toEqual(base);
});

it('EUR와 판매 희망가·미래·만료 가격을 데모 환산에 사용하지 않는다', () => {
  for (const changes of [
    { provider: 'CARDMARKET', originalCurrency: 'EUR' }, { priceType: 'ASKING_LOW' },
    { observedAt: '2026-11-25T00:00:00Z' }, { observedAt: '2026-11-20T00:00:00Z' },
    { providerVariant: 'unknown' }, { originalAmount: '0' },
  ]) expect(selectDemoUsdPrice([{ ...base, ...changes }], at, 72)).toBeUndefined();
  expect(selectDemoUsdPrice([{ ...base, observedAt: '2026-11-20T00:00:00Z' }, { ...base, providerVariant: 'holofoil' }], at, 72)?.providerVariant).toBe('holofoil');
});
