import { expect, it } from 'vitest';
import { parseApiEnv } from '../src/index.js';

it('문자열 false는 false로 파싱한다', () => {
  expect(parseApiEnv({ DATABASE_ENABLED: 'false' }).DATABASE_ENABLED).toBe(false);
});
it('DB 활성화 시 URL이 필요하며 미구현 실제 데이터 모드는 거부한다', () => {
  expect(() => parseApiEnv({ DATABASE_ENABLED: 'true' })).toThrow();
  expect(() => parseApiEnv({ DATA_MODE: 'live' })).toThrow();
});
it('DB 어댑터를 요청하면 DB 연결도 활성화해야 한다', () => {
  expect(() => parseApiEnv({ CARD_DATA_SOURCE: 'database' })).toThrow();
  expect(parseApiEnv({ CARD_DATA_SOURCE: 'database', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/tcg' }).CARD_DATA_SOURCE).toBe('database');
});
