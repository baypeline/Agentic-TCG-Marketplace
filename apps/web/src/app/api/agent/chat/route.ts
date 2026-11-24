import { NextRequest, NextResponse } from 'next/server';
import { createLocalAgentToken, getLocalAgentSecret, isLoopbackHost, readLocalAgentUserId } from '@tcg/config/local-agent-auth';
import { idSchema } from '@tcg/contracts';

const sessionPath = '/api/agent/sessions';
const identityCookie = 'tcg-local-agent';

function error(status: number, message: string) {
  return NextResponse.json({ message }, { status, headers: { 'cache-control': 'no-store' } });
}

export async function POST(request: NextRequest) {
  const secret = getLocalAgentSecret(process.env.NODE_ENV, process.env.AGENT_LOCAL_SECRET);
  const coreUrl = URL.parse(process.env.CORE_API_URL ?? 'http://127.0.0.1:4000');
  if (!secret || !coreUrl || !['http:', 'https:'].includes(coreUrl.protocol) || !isLoopbackHost(coreUrl.hostname)) {
    return error(503, '로컬 에이전트 연결 설정을 확인해 주세요.');
  }

  const origin = request.headers.get('origin');
  const host = request.headers.get('host');
  if (!isLoopbackHost(request.nextUrl.hostname) || !host || (origin !== `http://${host}` && origin !== `https://${host}`)) {
    return error(403, '이 웹 화면에서 보낸 요청만 처리할 수 있습니다.');
  }

  const body = await request.json().catch(() => null);
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 2000) return error(400, '1~2000자의 메시지를 입력해 주세요.');
  const parsedId = idSchema.optional().safeParse(body.sessionId);
  if (!parsedId.success) return error(400, '대화 세션 정보가 올바르지 않습니다.');

  const existing = request.cookies.get(identityCookie)?.value;
  const token = existing && readLocalAgentUserId(existing, secret) ? existing : createLocalAgentToken(secret);
  const headers = { authorization: `Bearer ${token}` };
  let sessionId = parsedId.data;

  try {
    if (!sessionId) {
      const created = await fetch(new URL(sessionPath, coreUrl), {
        method: 'POST', headers, cache: 'no-store', redirect: 'error',
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(5000)]),
      });
      if (!created.ok) return error(503, '에이전트 세션을 열 수 없습니다. API 서버 설정을 확인해 주세요.');
      sessionId = idSchema.parse((await created.json()).id);
    }

    const upstream = await fetch(new URL(`${sessionPath}/${sessionId}/messages`, coreUrl), {
      method: 'POST', cache: 'no-store', redirect: 'error',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ message }),
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(65_000)]),
    });

    if (upstream.status === 404) return error(404, '대화가 만료됐습니다. 대화를 비운 뒤 다시 보내주세요.');
    if (upstream.status === 409) return error(409, '이전 메시지를 처리 중입니다. 잠시 뒤 다시 보내주세요.');
    if (!upstream.ok || !upstream.body || !upstream.headers.get('content-type')?.startsWith('text/event-stream')) {
      return error(502, '에이전트 응답을 시작하지 못했습니다.');
    }

    const response = new NextResponse(upstream.body, {
      headers: {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        'x-accel-buffering': 'no',
        'x-agent-session-id': sessionId,
      },
    });
    if (token !== existing) {
      response.cookies.set(identityCookie, token, {
        httpOnly: true, sameSite: 'strict', secure: request.nextUrl.protocol === 'https:', path: '/api/agent/chat',
      });
    }
    return response;
  } catch {
    return error(502, '에이전트 API와 연결하지 못했습니다. 잠시 뒤 다시 보내주세요.');
  }
}
