import { createPublicClient, http, parseAbi } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { signPayment, validatePaymentRequirements } from '@tcg/payment-client';
import { AppError, agentPaymentRequirementsSchema, idSchema, type AgentPurchaseProgress } from '@tcg/contracts';
import type { ApiEnv } from '@tcg/config';

export type AgentPaymentSigner = (input: {
  requirements: NonNullable<AgentPurchaseProgress['requirements']>;
  amount: string;
  matchQuoteId: string;
}) => Promise<unknown>;

const token = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const maxAmount = 25_000n; // 기존 시나리오 정책과 같은 건당 0.025 USDC 상한

/** 개인키는 시작 시 이 클로저에서만 읽으며 환경 DTO나 응답에 넣지 않는다. */
export function createAgentWallet(env: ApiEnv, variables: NodeJS.ProcessEnv, options: {
  readBalance?: (address: `0x${string}`) => Promise<bigint>;
} = {}) {
  if (env.AGENT_SIGNING_MODE !== 'server') return null;
  if (!env.DEMO_SCENARIOS_ENABLED || !env.PAYMENT_ENABLED || env.NODE_ENV === 'production' || !['127.0.0.1', 'localhost', '::1'].includes(env.API_HOST)) throw new Error('에이전트 서명은 로컬 테스트넷 데모에서만 사용할 수 있습니다.');
  const key = variables.AGENT_SERVER_PRIVATE_KEY;
  let account: ReturnType<typeof privateKeyToAccount>;
  try {
    if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error();
    account = privateKeyToAccount(key as `0x${string}`);
  } catch { throw new Error('AGENT_SERVER_PRIVATE_KEY에 유효한 전용 지갑 키가 필요합니다.'); }
  if (!env.AGENT_SERVER_WALLET_ADDRESS || account.address.toLowerCase() !== env.AGENT_SERVER_WALLET_ADDRESS.toLowerCase() || account.address.toLowerCase() === env.PAYMENT_RECIPIENT?.toLowerCase()) throw new Error('전용 지갑 주소와 개인키 또는 수납 지갑 설정을 확인하세요.');
  const chain = createPublicClient({ chain: baseSepolia, transport: http(undefined, { timeout: 10_000, retryCount: 1 }) });
  const readBalance = options.readBalance ?? (address => chain.readContract({ address: token, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [address] }));
  const sign: AgentPaymentSigner = async input => {
    const parsed = agentPaymentRequirementsSchema.safeParse(input.requirements);
    if (!parsed.success || !idSchema.safeParse(input.matchQuoteId).success) throw new AppError('PAYMENT_FAILED', '서버 결제 요구 형식을 확인하세요.', 409);
    const requirements = parsed.data;
    if (requirements.amount !== input.amount || requirements.extra.name !== 'USDC' || requirements.extra.version !== '2' || requirements.extra.assetTransferMethod && requirements.extra.assetTransferMethod !== 'eip3009') throw new AppError('PAYMENT_FAILED', '매물 금액과 USDC 지급 요구가 일치하지 않습니다.', 409);
    try { validatePaymentRequirements(requirements, { allowedRecipient: env.PAYMENT_RECIPIENT!, maxAmountPerPayment: maxAmount }); }
    catch { throw new AppError('POLICY_VIOLATION', '허용된 토큰·네트워크·수납 주소와 건당 0.025 USDC 한도를 확인하세요.', 409); }
    let balance: bigint;
    try { balance = await readBalance(account.address); }
    catch { throw new AppError('PAYMENT_UNAVAILABLE', '에이전트 지갑 잔액을 확인하지 못했습니다.', 503, true); }
    if (balance < BigInt(requirements.amount)) throw new AppError('PAYMENT_UNAVAILABLE', '에이전트 전용 지갑에 Base Sepolia 테스트 USDC를 충전해 주세요.', 409);
    try { return await signPayment(requirements, { allowedRecipient: env.PAYMENT_RECIPIENT!, maxAmountPerPayment: maxAmount }, account, `mcp://tool/execute_purchase/${input.matchQuoteId}`); }
    catch { throw new AppError('PAYMENT_FAILED', '에이전트 지급 승인을 생성하지 못했습니다.', 503); }
  };
  return { address: account.address, sign };
}
