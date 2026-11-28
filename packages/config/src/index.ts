import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATA_MODE: z.literal('mock').default('mock'),
  CARD_DATA_SOURCE: z.enum(['mock', 'database']).default('mock'),
  PRICE_DATA_SOURCE: z.enum(['mock', 'market']).default('mock'),
  MARKET_VALUATION_MODE: z.enum(['demo', 'strict']).default('demo'),
  DEMO_SCENARIOS_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  PAYMENT_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  PAYMENT_CHAIN: z.enum(['base-sepolia', 'maroo']).default('base-sepolia'),
  RWA_ENABLED: z.enum(['true', 'false']).default('false').transform(v => v === 'true'),
  RWA_MARKET_ADDRESS: z.string().regex(/^0x[\da-fA-F]{40}$/).optional(),
  RWA_NFT_ADDRESS: z.string().regex(/^0x[\da-fA-F]{40}$/).optional(),
  RWA_QUOTE_SIGNER: z.string().regex(/^0x[\da-fA-F]{40}$/).optional(),
  RWA_MARKET_CODE_HASH: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(),
  RWA_NFT_CODE_HASH: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(),
  RWA_DEPLOY_BLOCK: z.coerce.bigint().nonnegative().optional(),
  PAYMENT_FACILITATOR_URL: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)).default('https://x402.org/facilitator'),
  PAYMENT_FACILITATOR_TOKEN: z.string().min(32).optional(),
  PAYMENT_RECIPIENT: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  AGENT_WALLET_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  AGENT_SIGNING_MODE: z.enum(['browser', 'server']).default('browser'),
  AGENT_SERVER_WALLET_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).optional(),
  TRADING_DATA_SOURCE: z.enum(['mock', 'database']).default('mock'),
  TRADING_SWEEP_INTERVAL_MS: z.coerce.number().int().min(100).max(3_600_000).default(30_000),
  DEMO_SELLER_TOKEN: z.string().min(32).optional(),
  DEMO_BUYER_TOKEN: z.string().min(32).optional(),
  DATABASE_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  DATABASE_URL: z.url().optional(),
}).superRefine((env, ctx) => {
  if (env.RWA_ENABLED && (env.PAYMENT_CHAIN !== 'maroo' || !env.PAYMENT_ENABLED || !env.DEMO_SCENARIOS_ENABLED || !env.RWA_MARKET_ADDRESS || !env.RWA_NFT_ADDRESS || !env.RWA_QUOTE_SIGNER || !env.RWA_MARKET_CODE_HASH || !env.RWA_NFT_CODE_HASH || env.RWA_DEPLOY_BLOCK === undefined)) ctx.addIssue({ code: 'custom', path: ['RWA_ENABLED'], message: 'RWA에는 검증된 마루 배포 정보와 로컬 결제 데모가 필요합니다.' });
  if (env.PAYMENT_CHAIN === 'maroo' && (!env.DEMO_SCENARIOS_ENABLED || env.AGENT_SIGNING_MODE !== 'server' || env.PAYMENT_FACILITATOR_URL === 'https://x402.org/facilitator')) ctx.addIssue({ code: 'custom', path: ['PAYMENT_CHAIN'], message: '마루 결제는 별도 DB의 로컬 시나리오·서버 서명·자체 퍼실리테이터가 필요합니다.' });
  if (env.AGENT_SIGNING_MODE === 'server' && (!env.DEMO_SCENARIOS_ENABLED || !env.PAYMENT_ENABLED || !env.AGENT_SERVER_WALLET_ADDRESS)) ctx.addIssue({ code: 'custom', path: ['AGENT_SIGNING_MODE'], message: '서버 서명에는 로컬 시나리오 결제와 전용 지갑 주소가 필요합니다.' });
  if (env.DEMO_SCENARIOS_ENABLED && (env.NODE_ENV === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(env.API_HOST) || !env.DATABASE_ENABLED || env.CARD_DATA_SOURCE !== 'database' || env.TRADING_DATA_SOURCE !== 'database' || !env.DEMO_BUYER_TOKEN || !env.DEMO_SELLER_TOKEN)) ctx.addIssue({ code: 'custom', path: ['DEMO_SCENARIOS_ENABLED'], message: '시나리오 데모에는 로컬 DB 카드·거래와 데모 인증 토큰이 필요합니다.' });
  if (env.PAYMENT_ENABLED && (!env.DATABASE_ENABLED || env.TRADING_DATA_SOURCE !== 'database' || !env.PAYMENT_RECIPIENT || !(env.AGENT_SIGNING_MODE === 'server' ? env.AGENT_SERVER_WALLET_ADDRESS : env.AGENT_WALLET_ADDRESS))) ctx.addIssue({ code: 'custom', path: ['PAYMENT_ENABLED'], message: '실결제에는 DB 거래와 수납·Agent 지갑 주소가 필요합니다.' });
  if (env.TRADING_DATA_SOURCE === 'database' && (!env.DATABASE_ENABLED || env.CARD_DATA_SOURCE !== 'database')) {
    ctx.addIssue({ code: 'custom', path: ['TRADING_DATA_SOURCE'], message: 'DB 거래에는 DB 연결과 CARD_DATA_SOURCE=database가 필요합니다.' });
  }
  if (env.DEMO_SELLER_TOKEN || env.DEMO_BUYER_TOKEN) {
    if (!env.DEMO_SELLER_TOKEN || !env.DEMO_BUYER_TOKEN || env.DEMO_SELLER_TOKEN === env.DEMO_BUYER_TOKEN) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_BUYER_TOKEN'], message: '데모 판매자·구매자 토큰을 서로 다르게 함께 설정하세요.' });
    }
    if (env.NODE_ENV === 'production' || !['127.0.0.1', '::1', 'localhost'].includes(env.API_HOST)) {
      ctx.addIssue({ code: 'custom', path: ['DEMO_SELLER_TOKEN'], message: '데모 인증은 로컬 개발·테스트에서만 허용합니다.' });
    }
  }
  if (env.DATABASE_ENABLED && !env.DATABASE_URL) {
    ctx.addIssue({ code: 'custom', path: ['DATABASE_URL'], message: 'DB 연결 시 DATABASE_URL이 필요합니다.' });
  }
  if (env.CARD_DATA_SOURCE === 'database' && !env.DATABASE_ENABLED) {
    ctx.addIssue({ code: 'custom', path: ['CARD_DATA_SOURCE'], message: 'DB 카드 조회에는 DATABASE_ENABLED=true가 필요합니다.' });
  }
  if (env.PRICE_DATA_SOURCE === 'market' && (env.CARD_DATA_SOURCE !== 'database' || !env.DATABASE_ENABLED)) {
    ctx.addIssue({ code: 'custom', path: ['PRICE_DATA_SOURCE'], message: '실제 가격 조회에는 DB 카드 조회와 DB 연결이 필요합니다.' });
  }
});

export type ApiEnv = z.infer<typeof apiEnvSchema>;
export function parseApiEnv(input: Record<string, unknown>): ApiEnv {
  return apiEnvSchema.parse(input);
}
