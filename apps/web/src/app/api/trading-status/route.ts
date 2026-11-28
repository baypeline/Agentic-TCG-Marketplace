import { tradingAuthorization } from '../../../lib/trading-auth';
import { agentRunSchema, budgetSchema, currencySchema, idSchema, purchaseStatusSchema, spendingPolicySchema } from '@tcg/contracts';

export async function GET(request: Request) {
  const authorization = await tradingAuthorization(request);
  if (!authorization) return Response.json({ error: '지갑을 연결하면 거래 상태를 확인할 수 있어요.' }, { status: 401 });
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
    const proceeds = await get('/api/seller-proceeds') as { amount: string; currency?: string; tradeCount: number; withdrawable: false };
    if (!/^(0|[1-9]\d*)$/.test(proceeds.amount) || !Number.isInteger(proceeds.tradeCount) || proceeds.tradeCount < 0 || proceeds.withdrawable !== false) throw new Error('Invalid proceeds');
    return Response.json({ currency: currencySchema.parse(proceeds.currency ?? 'USDC'), budgets, runs, purchases, proceeds }, { headers: { 'Cache-Control': 'private, no-store' } });
  } catch (error) {
    const status = error instanceof Error && error.message === '401' ? 401 : 502;
    return Response.json({ error: status === 401 ? '인증 세션을 확인해 주세요.' : '서버 상태를 조회하지 못했습니다. 기존 거래를 다시 실행하지 말고 잠시 후 조회하세요.' }, { status });
  }
}
