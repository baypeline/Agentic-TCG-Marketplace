import { z } from 'zod';

export const apiEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATA_MODE: z.literal('mock').default('mock'),
  CARD_DATA_SOURCE: z.enum(['mock', 'database']).default('mock'),
  PRICE_DATA_SOURCE: z.enum(['mock', 'market']).default('mock'),
  DATABASE_ENABLED: z.enum(['true', 'false']).default('false').transform(value => value === 'true'),
  DATABASE_URL: z.url().optional(),
}).superRefine((env, ctx) => {
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
