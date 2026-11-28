import { randomBytes } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { walletChallengeSchema, walletSessionSchema, walletChallengeInputSchema, walletVerifyInputSchema } from '@tcg/contracts';

const bindingCookie = 'tcg_auth_challenge', sessionCookie = 'tcg_session';
const noStore = { 'Cache-Control': 'private, no-store' };
async function handle(request: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params;
  const allowed = request.method === 'GET' ? action === 'session' : ['challenge', 'verify', 'logout'].includes(action);
  if (!allowed) return NextResponse.json({ message: '지원하지 않는 인증 요청입니다.' }, { status: 404, headers: noStore });
  const origin = new URL(request.url).origin;
  const site = request.headers.get('origin');
  const host = request.headers.get('host') ?? request.nextUrl.host;
  if (request.method === 'POST' && (site !== `http://${host}` && site !== `https://${host}` || ['cross-site', 'same-site'].includes(request.headers.get('sec-fetch-site') ?? ''))) return NextResponse.json({ message: '같은 웹 화면에서 로그인해 주세요.' }, { status: 403, headers: noStore });
  const core = process.env.CORE_API_URL ?? 'http://127.0.0.1:4000';
  const cookieOptions = { httpOnly: true, secure: request.nextUrl.protocol === 'https:', sameSite: 'strict' as const, path: '/' };
  const token = request.cookies.get(sessionCookie)?.value;
  const upstreamHeaders = { 'content-type': 'application/json', origin: site ?? origin, ...(token && ['session','logout'].includes(action) ? { authorization: `Bearer ${token}` } : {}) };
  if (action === 'session' && !token) return NextResponse.json({ user: null }, { headers: noStore });
  try {
    let body: object | undefined, binding: string | undefined;
    if (action === 'challenge') {
      const input = walletChallengeInputSchema.parse(await request.json());
      binding = randomBytes(32).toString('hex'); body = { ...input, binding };
    } else if (action === 'verify') {
      const input = walletVerifyInputSchema.parse(await request.json());
      const challenge = request.cookies.get(bindingCookie)?.value?.match(/^([a-f0-9-]{36})\.([a-f0-9]{64})$/);
      if (!challenge) return NextResponse.json({ message: '로그인 요청이 만료됐습니다. 다시 연결해 주세요.' }, { status: 401, headers: noStore });
      body = { ...input, challengeId: challenge[1], binding: challenge[2] };
    } else if (action === 'logout') {
      body = {};
    }
    const upstream = await fetch(new URL(`/api/auth/${action}`, core), { method: request.method, headers: upstreamHeaders, ...(body ? { body: JSON.stringify(body) } : {}), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const data = await upstream.json();
    if (!upstream.ok && !(action === 'session' && upstream.status === 401) && !(action === 'logout' && upstream.status === 401)) return NextResponse.json({ message: data.error?.message ?? '지갑 인증을 완료하지 못했습니다.' }, { status: upstream.status, headers: noStore });
    const result = action === 'challenge' ? walletChallengeSchema.parse(data) : walletSessionSchema.parse(upstream.ok ? data : { user: null });
    const response = NextResponse.json(result, { headers: noStore });
    if (action === 'challenge') response.cookies.set(bindingCookie, `${(result as { id: string }).id}.${binding}`, { ...cookieOptions, maxAge: 300 });
    if (action === 'verify') {
      if (typeof data.token !== 'string' || !/^wallet_[a-f0-9]{64}$/.test(data.token)) throw new Error('Invalid session');
      response.cookies.set(sessionCookie, data.token, { ...cookieOptions, maxAge: 8 * 60 * 60 });
      response.cookies.set(bindingCookie, '', { ...cookieOptions, maxAge: 0 });
    }
    if (action === 'logout' || action === 'session' && !upstream.ok) {
      response.cookies.set(sessionCookie, '', { ...cookieOptions, maxAge: 0 });
      response.cookies.set('tcg-local-agent', '', { ...cookieOptions, path: '/api/agent/chat', maxAge: 0 });
      response.cookies.set(bindingCookie, '', { ...cookieOptions, maxAge: 0 });
    }
    return response;
  } catch (error) {
    const invalid = error instanceof Error && ['ZodError','SyntaxError'].includes(error.name);
    return NextResponse.json({ message: invalid ? '로그인 요청 형식을 확인해 주세요.' : '인증 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.' }, { status: invalid ? 400 : 502, headers: noStore });
  }
}
export { handle as GET, handle as POST };
