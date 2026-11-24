import { cookies } from 'next/headers';
import { agentRunSchema, budgetSchema, idSchema, purchaseStatusSchema, spendingPolicySchema } from '@tcg/contracts';

export async function GET(request: Request) {
  const cookie = (await cookies()).get('tcg_session')?.value;
  // 실제 사용자 세션/Bearer를 전달한다. 로컬 시연도 역할을 명시한 경우에만 서버 토큰을 사용한다.
  const demoRole = process.env.NODE_ENV !== 'production' ? process.env.WEB_DEMO_ROLE : undefined;
  const demoToken = demoRole === 'buyer' ? process.env.DEMO_BUYER_TOKEN : demoRole === 'seller' ? process.env.DEMO_SELLER_TOKEN : undefined;
  const authorization = request.headers.get('authorization') ?? (cookie ? `Bearer ${cookie}` : demoToken ? `Bearer ${demoToken}` : null);
  if (!authorization) return Response.json({ error: '상태 조회에는 로그인 또는 로컬 시연 역할 설정이 필요합니다.' }, { status: 401 });
  async function get(path: string, optionalAgent = false): Promise<unknown> {
    const result = await fetch(new URL(path, process.env.CORE_API_URL ?? 'http://127.0.0.1:4000'), { headers: { authorization: authorization! }, cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (optionalAgent && result.status === 403) return [];
    if (!result.ok) throw new Error(String(result.status));
    return result.json();
  }
  try {
    const rawPolicies = await get('/api/policies', true);
    const policies = spendingPolicySchema.array().parse(rawPolicies);
    const budgets = await Promise.all(policies.map(async policy => ({ policy, budget: budgetSchema.parse(await get(`/api/policies/${policy.id}/budget`)) })));
    const runs = agentRunSchema.array().parse(await get('/sessions', true));
    const matches = await get('/api/matches', true) as { id: string }[];
    const purchases = await Promise.all(matches.map(async match => purchaseStatusSchema.parse(await get(`/api/purchases/${idSchema.parse(match.id)}/status`))));
    const proceeds = await get('/api/seller-proceeds') as { amount: string; tradeCount: number; withdrawable: false };
    if (!/^(0|[1-9]\d*)$/.test(proceeds.amount) || !Number.isInteger(proceeds.tradeCount) || proceeds.tradeCount < 0 || proceeds.withdrawable !== false) throw new Error('Invalid proceeds');
    return Response.json({ budgets, runs, purchases, proceeds }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof Error && error.message === '401' ? 401 : 502;
    return Response.json({ error: status === 401 ? '인증 세션을 확인해 주세요.' : '서버 상태를 조회하지 못했습니다. 기존 거래를 다시 실행하지 말고 잠시 후 조회하세요.' }, { status });
  }
}
