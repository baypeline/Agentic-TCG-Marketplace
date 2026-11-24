import { expect, it } from 'vitest';
import { parseApiEnv } from '../src/index.js';

const tokens = { DEMO_SELLER_TOKEN: 's'.repeat(32), DEMO_BUYER_TOKEN: 'b'.repeat(32) };

it('거래 저장소를 명시적으로 선택하며 DB 거래는 DB 카드와 연결을 요구한다', () => {
  expect(parseApiEnv({}).TRADING_DATA_SOURCE).toBe('mock');
  expect(() => parseApiEnv({ TRADING_DATA_SOURCE: 'database' })).toThrow();
  expect(() => parseApiEnv({ TRADING_DATA_SOURCE: 'database', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg' })).toThrow();
  expect(parseApiEnv({ TRADING_DATA_SOURCE: 'database', CARD_DATA_SOURCE: 'database', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg' }).TRADING_DATA_SOURCE).toBe('database');
  expect(() => parseApiEnv({ TRADING_SWEEP_INTERVAL_MS: 0 })).toThrow();
});

it('데모 인증은 별도 토큰 두 개가 필요하며 로컬 개발 환경에서만 허용한다', () => {
  expect(parseApiEnv(tokens).DEMO_SELLER_TOKEN).toBe(tokens.DEMO_SELLER_TOKEN);
  for (const input of [
    { DEMO_SELLER_TOKEN: tokens.DEMO_SELLER_TOKEN },
    { ...tokens, DEMO_BUYER_TOKEN: tokens.DEMO_SELLER_TOKEN },
    { ...tokens, DEMO_BUYER_TOKEN: 'short' },
    { ...tokens, NODE_ENV: 'production' },
    { ...tokens, API_HOST: '0.0.0.0' },
  ]) expect(() => parseApiEnv(input)).toThrow();
});
