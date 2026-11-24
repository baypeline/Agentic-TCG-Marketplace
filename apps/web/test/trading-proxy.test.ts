import { afterEach, expect, it, vi } from 'vitest';
import { coreTradingPath, proxyTrading } from '../src/lib/trading-proxy';
const id = '00000000-0000-4000-8000-000000000001';
const base = 'http://127.0.0.1:4000';
afterEach(() => vi.unstubAllGlobals());
function request(origin = 'http://localhost:3000') { return new Request('http://localhost:3000/api/trading/policies', { method: 'POST', headers: { origin, 'idempotency-key': 'same-intent', 'content-type': 'application/json' }, body: '{}' }); }
it('서명·지급·임의 경로를 중계하지 않는다', () => {
  expect(coreTradingPath('POST',['execute_purchase'])).toBeNull();
  expect(coreTradingPath('POST',['purchases',id,'execute'])).toBeNull();
  expect(coreTradingPath('DELETE',['policies',id])).toBeNull();
  expect(coreTradingPath('GET',['cards','..'])).toBeNull();
  expect(coreTradingPath('POST',['sessions',id,'stop'])).toBe(`/sessions/${id}/stop`);
});
it('교차 출처·인증 누락·요청 키 누락은 서버를 호출하기 전에 거부한다', async () => {
  const upstream = vi.fn(); vi.stubGlobal('fetch',upstream);
  expect((await proxyTrading(request('https://foreign.test'),['policies'],'Bearer test',base)).status).toBe(403);
  expect((await proxyTrading(request(),['policies'],null,base)).status).toBe(401);
  const noKey = new Request(request()); noKey.headers.delete('idempotency-key');
  expect((await proxyTrading(noKey,['policies'],'Bearer test',base)).status).toBe(400);
  expect(upstream).not.toHaveBeenCalled();
});
it('검증된 신원과 동일 요청 키만 전달하고 업무 오류를 보존한다', async () => {
  const upstream = vi.fn(async () => Response.json({ error: { code: 'BUDGET_EXCEEDED', message: '예산 하한 미달' } },{ status:409 })); vi.stubGlobal('fetch',upstream);
  const response = await proxyTrading(request(),['policies'],'Bearer verified',base);
  expect(response.status).toBe(409);
  expect(upstream.mock.calls[0]![0]).toEqual(new URL('/api/policies',base));
  expect(upstream.mock.calls[0]![1]).toMatchObject({ headers: { authorization:'Bearer verified', 'idempotency-key':'same-intent' }, redirect:'error' });
  expect(response.headers.get('cache-control')).toBe('private, no-store');
});
it('대용량 본문은 중계하지 않고 응답 유실은 불명확한 결과로 반환한다', async () => {
  const upstream = vi.fn(async () => { throw new Error('network'); }); vi.stubGlobal('fetch',upstream);
  const big = new Request(request(),{ body:' '.repeat(16385) });
  expect((await proxyTrading(big,['policies'],'Bearer test',base)).status).toBe(413);
  expect(upstream).not.toHaveBeenCalled();
  expect((await proxyTrading(request(),['policies'],'Bearer test',base)).status).toBe(502);
});

it('Next 내부 URL과 바인딩 주소가 달라도 실제 Host가 같은 요청은 허용한다', async () => {
  const upstream = vi.fn(async () => Response.json({ id:'created' })); vi.stubGlobal('fetch',upstream);
  const r = new Request('http://localhost:3000/api/trading/policies',{ method:'POST', headers:{ host:'127.0.0.1:3000', origin:'http://127.0.0.1:3000', 'idempotency-key':'one' }, body:'{}' });
  expect((await proxyTrading(r,['policies'],'Bearer test',base)).status).toBe(200);
});

it('본문 없는 제어 요청에 JSON Content-Type을 붙여 Fastify 파싱 오류를 만들지 않는다', async () => {
  const upstream = vi.fn(async (..._args: unknown[]) => Response.json({ status:'STOPPED' })); vi.stubGlobal('fetch',upstream);
  const r = new Request(`http://localhost:3000/api/trading/sessions/${id}/stop`,{ method:'POST',headers:{ origin:'http://localhost:3000','idempotency-key':'stop' } });
  expect((await proxyTrading(r,['sessions',id,'stop'],'Bearer test',base)).status).toBe(200);
  expect((upstream.mock.calls[0]![1] as RequestInit).headers).not.toHaveProperty('content-type');
});
