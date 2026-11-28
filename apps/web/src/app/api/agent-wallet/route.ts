import { agentWalletInfoSchema } from '@tcg/contracts';
import { tradingAuthorization } from '../../../lib/trading-auth';

export async function GET(request: Request) {
  const authorization = await tradingAuthorization(request);
  const headers = { 'Cache-Control': 'private, no-store' };
  if (!authorization) return Response.json({ message: '지갑 로그인이 필요합니다.' }, { status: 401, headers });
  try {
    const result = await fetch(new URL('/api/agent/wallet', process.env.CORE_API_URL ?? 'http://127.0.0.1:4000'), { headers: { authorization }, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15_000) });
    const data = await result.json();
    if (!result.ok) return Response.json({ message: data.error?.message ?? '에이전트 지갑을 확인하지 못했습니다.' }, { status: result.status, headers });
    return Response.json(agentWalletInfoSchema.parse(data), { headers });
  } catch { return Response.json({ message: '에이전트 지갑을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.' }, { status: 502, headers }); }
}
