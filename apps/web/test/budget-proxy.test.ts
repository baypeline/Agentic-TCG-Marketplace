import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { createLocalAgentToken } from '@tcg/config/local-agent-auth';
import { POST } from '../src/app/api/agent/chat/budget/route';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
const sessionId = '00000000-0000-4000-8000-000000000001', proposalId = '00000000-0000-4000-8000-000000000002';
function fixture() {
  const secret = 'test-budget-secret-'.repeat(3);
  vi.stubEnv('NODE_ENV', 'development'); vi.stubEnv('AGENT_LOCAL_SECRET', secret); vi.stubEnv('CORE_API_URL', 'http://127.0.0.1:4000');
  const token = createLocalAgentToken(secret);
  const request = (extra: object = {}, origin = 'http://127.0.0.1:3000', cookie = `tcg-local-agent=${token}`) => new NextRequest('http://127.0.0.1:3000/api/agent/chat/budget', { method: 'POST', headers: { host: '127.0.0.1:3000', origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, proposalId, action: 'confirm', ...extra }) });
  return { token, request };
}
it('교차 출처·쿠키 누락·클라이언트 금액 주입을 거부하고 세션의 변경안 ID만 중계한다', async () => {
  const { token, request } = fixture();
  const upstream = vi.fn(async () => Response.json({ proposalId, status: 'APPLIED', currency: 'tOKRW' })); vi.stubGlobal('fetch', upstream);
  expect((await POST(request({}, 'https://foreign.test'))).status).toBe(403);
  expect((await POST(request({}, 'http://127.0.0.1:3000', ''))).status).toBe(401);
  expect((await POST(request({ totalBudget: '99999999' }))).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
  const result = await POST(request()); expect(result.status).toBe(200);
  expect(upstream.mock.calls[0]).toMatchObject([new URL(`/api/agent/sessions/${sessionId}/budget`, 'http://127.0.0.1:4000'), { headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ proposalId, action: 'confirm' }), redirect: 'error' }]);
});
