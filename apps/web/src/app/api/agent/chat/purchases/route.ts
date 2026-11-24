import { NextRequest, NextResponse } from 'next/server';
import { getLocalAgentSecret, isLoopbackHost, readLocalAgentUserId } from '@tcg/config/local-agent-auth';
import { agentPurchaseInputSchema, agentPurchaseProgressSchema, idSchema } from '@tcg/contracts';

export async function POST(request: NextRequest) {
  const secret = getLocalAgentSecret(process.env.NODE_ENV, process.env.AGENT_LOCAL_SECRET);
  const host = request.headers.get('host');
  const origin = request.headers.get('origin');
  const core = URL.parse(process.env.CORE_API_URL ?? 'http://127.0.0.1:4000');
  if (!secret || !core || !['http:', 'https:'].includes(core.protocol) || !isLoopbackHost(core.hostname)) return NextResponse.json({ message: '거래 연결 설정을 확인해 주세요.' }, { status: 503 });
  if (!host || !isLoopbackHost(request.nextUrl.hostname) || (origin !== `http://${host}` && origin !== `https://${host}`)) return NextResponse.json({ message: '이 화면에서 보낸 요청만 처리합니다.' }, { status: 403 });
  const token = request.cookies.get('tcg-local-agent')?.value;
  if (!token || !readLocalAgentUserId(token, secret)) return NextResponse.json({ message: '먼저 에이전트와 대화를 시작해 주세요.' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const input = agentPurchaseInputSchema.extend({ sessionId: idSchema }).safeParse(body);
  if (!input.success) return NextResponse.json({ message: '구매 요청 형식을 확인해 주세요.' }, { status: 400 });
  const { sessionId, ...purchase } = input.data;
  try {
    const result = await fetch(new URL(`/api/agent/sessions/${sessionId}/purchases`, core), {
      method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(purchase), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(65_000),
    });
    const data = await result.json();
    if (!result.ok) return NextResponse.json({ message: data?.error?.message ?? '구매를 진행하지 못했습니다.' }, { status: result.status, headers: { 'cache-control': 'no-store' } });
    return NextResponse.json(agentPurchaseProgressSchema.parse(data), { headers: { 'cache-control': 'no-store' } });
  } catch { return NextResponse.json({ message: '거래 응답을 확인하지 못했습니다. 새 결제를 만들지 말고 기존 거래 상태를 확인해 주세요.' }, { status: 502 }); }
}
