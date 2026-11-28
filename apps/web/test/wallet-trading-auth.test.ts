import { afterEach, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ cookie: undefined as string | undefined }));
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => state.cookie ? { value: state.cookie } : undefined }) }));
import { tradingAuthorization } from '../src/lib/trading-auth';
afterEach(() => { state.cookie = undefined; vi.unstubAllEnvs(); });
it('로그인 쿠키를 우선하고 로그아웃 상태에서는 공통 데모 역할로 자동 진입하지 않는다', async () => {
  vi.stubEnv('WEB_DEMO_ROLE','buyer'); vi.stubEnv('DEMO_BUYER_TOKEN','legacy');
  const request = new Request('http://127.0.0.1:3000/api/trading/me');
  expect(await tradingAuthorization(request)).toBeNull();
  state.cookie = 'wallet-session'; expect(await tradingAuthorization(request)).toBe('Bearer wallet-session');
});
