import { idSchema, mutationContextSchema } from '@tcg/contracts';

// 고정 업무 경로만 중계한다. 지급 실행과 임의 URL/헤더 전달은 허용하지 않는다.
export function coreTradingPath(method: string, parts: string[]): string | null {
  const [resource, id, action] = parts;
  if (parts.length === 1) {
    if (method === 'GET' && ['me','inventory','listings','buy-orders','policies','trades','matches'].includes(resource!)) return `/api/${resource}`;
    if (resource === 'sessions' && ['GET','POST'].includes(method)) return '/sessions';
    if (method === 'POST' && ['policies','listings','buy-orders'].includes(resource!)) return `/api/${resource}`;
  }
  if (parts.length === 3 && resource === 'purchases' && ['fixed','market'].includes(id!) && action === 'quote' && method === 'POST') return `/api/purchases/${id}/quote`;
  if (!idSchema.safeParse(id).success) return null;
  if (parts.length === 2) {
    if (method === 'GET' && resource === 'cards') return `/api/cards/${id}`;
    if (method === 'PUT' && resource === 'policies') return `/api/policies/${id}`;
    if (method === 'DELETE' && ['listings','quotes'].includes(resource!)) return `/api/${resource}/${id}`;
  }
  if (parts.length === 3) {
    if (method === 'GET' && resource === 'policies' && ['budget','versions'].includes(action!)) return `/api/policies/${id}/${action}`;
    if (method === 'POST' && resource === 'buy-orders' && ['pause','resume','cancel','match'].includes(action!)) return `/api/buy-orders/${id}/${action}`;
    if (method === 'POST' && resource === 'sessions' && action === 'stop') return `/sessions/${id}/stop`;
  }
  return null;
}
export async function proxyTrading(request: Request, parts: string[], authorization: string | null, base: string) {
  const respond = (error: string, status: number) => Response.json({ error }, { status, headers: { 'Cache-Control': 'private, no-store' } });
  const path = coreTradingPath(request.method, parts);
  if (!path) return respond('지원하지 않는 거래 요청입니다.', 404);
  if (request.method !== 'GET') {
    let sameOrigin = false;
    try {
      const origin = new URL(request.headers.get('origin') ?? '');
      // Next 내부 Request.url의 호스트는 바인딩 주소와 다를 수 있다.
      // 브라우저가 보내는 실제 Host와 Origin을 비교한다. 역방향 프록시도 Host를 보존해야 한다.
      sameOrigin = ['http:','https:'].includes(origin.protocol) && origin.host === (request.headers.get('host') ?? new URL(request.url).host).toLowerCase();
    } catch { /* 유효한 Origin 필수 */ }
    if (!sameOrigin || ['cross-site','same-site'].includes(request.headers.get('sec-fetch-site') ?? '')) return respond('같은 사이트에서 요청해 주세요.', 403);
    if (!mutationContextSchema.safeParse({ idempotencyKey: request.headers.get('idempotency-key') }).success) return respond('안정적인 요청 키가 필요합니다.', 400);
  }
  if (!authorization) return respond('로그인 또는 로컬 시연 역할 설정이 필요합니다.', 401);
  let body: string | undefined;
  if (['POST','PUT'].includes(request.method)) {
    // 정책·주문 입력만 받는다. 서명과 대용량 데이터는 이 경계로 전달하지 않는다.
    if (Number(request.headers.get('content-length') ?? 0) > 16_384) return respond('요청이 너무 큽니다.', 413);
    body = await request.text();
    if (new TextEncoder().encode(body).byteLength > 16_384) return respond('요청이 너무 큽니다.', 413);
    if (body) { try { JSON.parse(body); } catch { return respond('입력 형식을 확인해 주세요.', 400); } }
  }
  try {
    const result = await fetch(new URL(path, base), { method: request.method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(10_000), headers: { authorization, ...(body ? { 'content-type': 'application/json' } : {}), ...(request.method === 'GET' ? {} : { 'idempotency-key': request.headers.get('idempotency-key')! }) }, body: body || undefined });
    const value = await result.json();
    return Response.json(value, { status: result.status, headers: { 'Cache-Control': 'private, no-store' } });
  } catch { return respond('서버 응답을 확인하지 못했습니다. 같은 요청으로 다시 확인해 주세요.', 502); }
}
