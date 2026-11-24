import { expect, it } from 'vitest';
import { parseApiEnv } from '../src/index.js';

it('문자열 false는 false로 파싱한다', () => {
  expect(parseApiEnv({ DATABASE_ENABLED: 'false' }).DATABASE_ENABLED).toBe(false);
});
it('시장 가격의 기본 방식은 demo이며 strict를 명시할 수 있다', () => {
  expect(parseApiEnv({}).MARKET_VALUATION_MODE).toBe('demo');
  expect(parseApiEnv({ MARKET_VALUATION_MODE: 'strict' }).MARKET_VALUATION_MODE).toBe('strict');
  expect(() => parseApiEnv({ MARKET_VALUATION_MODE: 'invalid' })).toThrow();
});
it('DB 활성화 시 URL이 필요하며 미구현 실제 데이터 모드는 거부한다', () => {
  expect(() => parseApiEnv({ DATABASE_ENABLED: 'true' })).toThrow();
  expect(() => parseApiEnv({ DATA_MODE: 'live' })).toThrow();
});
it('DB 어댑터를 요청하면 DB 연결도 활성화해야 한다', () => {
  expect(() => parseApiEnv({ CARD_DATA_SOURCE: 'database' })).toThrow();
  expect(parseApiEnv({ CARD_DATA_SOURCE: 'database', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg' }).CARD_DATA_SOURCE).toBe('database');
});

it('결제는 기본 비활성이며 활성화에는 영속 거래와 두 공개 주소를 요구한다', () => {
  expect(parseApiEnv({}).PAYMENT_ENABLED).toBe(false);
  expect(() => parseApiEnv({ PAYMENT_ENABLED: 'true' })).toThrow();
  const db = { DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg', CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', PAYMENT_ENABLED: 'true' };
  expect(() => parseApiEnv(db)).toThrow();
  expect(() => parseApiEnv({ ...db, PAYMENT_RECIPIENT: 'invalid', AGENT_WALLET_ADDRESS: '0x'+'2'.repeat(40) })).toThrow();
  expect(parseApiEnv({ ...db, PAYMENT_RECIPIENT: '0x'+'1'.repeat(40), AGENT_WALLET_ADDRESS: '0x'+'2'.repeat(40) }).PAYMENT_ENABLED).toBe(true);
});
