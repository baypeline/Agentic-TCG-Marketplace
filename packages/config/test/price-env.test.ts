import { expect, it } from 'vitest';
import { parseApiEnv } from '../src/index.js';
it('시장 가격 모드는 DB 카드와 연결을 요구하며 기본값은 Mock이다', () => {
  expect(parseApiEnv({}).PRICE_DATA_SOURCE).toBe('mock');
  expect(() => parseApiEnv({ PRICE_DATA_SOURCE: 'market' })).toThrow();
  expect(() => parseApiEnv({ PRICE_DATA_SOURCE: 'market', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg' })).toThrow();
  expect(parseApiEnv({ PRICE_DATA_SOURCE: 'market', CARD_DATA_SOURCE: 'database', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg' }).PRICE_DATA_SOURCE).toBe('market');
});
