import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';
import type { AuthContext } from '@tcg/contracts';
import { parseApiEnv, type ApiEnv } from '@tcg/config';
import { demoSellerId } from '@tcg/trading';

export const demoBuyerId = '00000000-0000-4000-8002-000000000002';
export const demoBuyerAgentId = '00000000-0000-4000-8002-000000000003';

// 로컬 실행 전용. ID 헤더나 요청 본문으로 사용자를 선택하지 않는다.
export function createDemoAuthResolver(input: ApiEnv) {
  const env = parseApiEnv({ ...input, RWA_ENABLED: String(input.RWA_ENABLED), DATABASE_ENABLED: String(input.DATABASE_ENABLED), PAYMENT_ENABLED: String(input.PAYMENT_ENABLED), DEMO_SCENARIOS_ENABLED: String(input.DEMO_SCENARIOS_ENABLED) });
  const matches = (provided: string, token: string | undefined) => {
    if (!token) return false;
    const expected = Buffer.from(`Bearer ${token}`);
    const actual = Buffer.from(provided);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  };
  return async (request: FastifyRequest): Promise<AuthContext | null> => {
    const authorization = request.headers.authorization ?? '';
    if (matches(authorization, env.DEMO_SELLER_TOKEN)) return { userId: demoSellerId };
    if (matches(authorization, env.DEMO_BUYER_TOKEN)) return { userId: demoBuyerId, agentId: demoBuyerAgentId };
    return null;
  };
}
