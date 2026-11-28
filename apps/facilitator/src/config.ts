import { z } from 'zod';
import { getPaymentProfile } from '@tcg/contracts/payment-profile';

export const network = 'eip155:84532';
export const asset = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const schema = z.object({
  RWA_MARKET_ADDRESS: z.string().optional(), RWA_NFT_ADDRESS: z.string().optional(), RWA_QUOTE_SIGNER: z.string().optional(), RWA_MARKET_CODE_HASH: z.string().optional(), RWA_NFT_CODE_HASH: z.string().optional(),
  FACILITATOR_CHAIN: z.enum(['base-sepolia', 'maroo']).default('base-sepolia'),
  FACILITATOR_HOST: z.string().default('127.0.0.1'),
  FACILITATOR_PORT: z.coerce.number().int().min(1).max(65535).default(4022),
  FACILITATOR_RPC_URL: z.url().refine(value => ['http:', 'https:'].includes(new URL(value).protocol)).default('https://sepolia.base.org'),
  FACILITATOR_API_TOKEN: z.string().min(32),
  FACILITATOR_PRIVATE_KEY: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  FACILITATOR_RECIPIENT: address,
  FACILITATOR_PAYERS: z.string().transform(s => s.split(',').map(s => address.parse(s.trim()).toLowerCase())).refine(s => s.length > 0 && s.length <= 10),
  FACILITATOR_MAX_AMOUNT: z.string().regex(/^[1-9]\d*$/).default('25000'),
  FACILITATOR_DATA_DIR: z.string().default('./data'),
  FACILITATOR_PAYER_REGISTRY_URL: z.preprocess(value => value === '' ? undefined : value, z.url().refine(value => { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password && !url.search && !url.hash; }).optional()),
});
export type FacilitatorEnv = z.infer<typeof schema>;
export function parseEnv(input: NodeJS.ProcessEnv): FacilitatorEnv {
  const parsed = schema.safeParse(input);
  // Zod 입력값이나 SDK 오류 원문에 비밀값을 노출하지 않는다.
  if (!parsed.success) throw new Error('퍼실리테이터 환경변수 형식을 확인하세요.');
  const profile = getPaymentProfile(parsed.data.FACILITATOR_CHAIN);
  return { ...parsed.data, FACILITATOR_RPC_URL: input.FACILITATOR_RPC_URL || profile.rpcUrl, FACILITATOR_MAX_AMOUNT: input.FACILITATOR_MAX_AMOUNT || profile.maxPerTrade };
}
