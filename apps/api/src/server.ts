import { config } from 'dotenv';
import { parseApiEnv } from '@tcg/config';
import { buildApp } from './app.js';
import { createIntegrationPlugins } from './integrations.js';
import { createLocalAgentOptions } from './local-agent.js';
import { createX402SettlementAdapter } from '@tcg/payment-server';
import { demoBuyerId, demoBuyerAgentId, createDemoAuthResolver } from './demo-auth.js';
import { AppError } from '@tcg/contracts';
import type { AgentSessionPluginOptions } from '@tcg/agent';
import { createAgentWallet } from './agent-wallet.js';
import { withPreviousWalletRecovery } from './wallet-recovery.js';
import { readRwaDeployment } from '@tcg/payment-client/rwa';
import { createWalletAuth } from './wallet-auth.js';

config({ path: '../../.env', quiet: true });
const env = parseApiEnv(process.env);
const browserWallet = env.AGENT_WALLET_ADDRESS;
const agentWallet = createAgentWallet(env, process.env);
// 브라우저 지갑 설정은 .env에 보존하고 실행 중의 지급 주체만 전용 지갑으로 선택한다.
if (agentWallet) env.AGENT_WALLET_ADDRESS = agentWallet.address;
const getWalletAddress = async (auth: { userId: string; agentId: string }) => auth.userId === demoBuyerId && auth.agentId === demoBuyerAgentId ? env.AGENT_WALLET_ADDRESS ?? null : null;
const previousWallet = agentWallet ? browserWallet : env.AGENT_SERVER_WALLET_ADDRESS;
const facilitatorOptions = { paymentChain: env.PAYMENT_CHAIN, facilitatorUrl: env.PAYMENT_FACILITATOR_URL, facilitatorToken: env.PAYMENT_FACILITATOR_TOKEN, rwa: env.RWA_ENABLED ? readRwaDeployment(env) : null };
const paymentOptions = env.PAYMENT_ENABLED ? { recipient: env.PAYMENT_RECIPIENT, getWalletAddress, adapter: withPreviousWalletRecovery(createX402SettlementAdapter({ getWalletAddress, ...facilitatorOptions }), previousWallet && previousWallet.toLowerCase() !== env.AGENT_WALLET_ADDRESS?.toLowerCase() ? createX402SettlementAdapter({ getWalletAddress: async auth => auth.userId === demoBuyerId && auth.agentId === demoBuyerAgentId ? previousWallet : null, ...facilitatorOptions }) : undefined) } : undefined;
let demoPurchase: AgentSessionPluginOptions['purchase'];
let agentBudget: AgentSessionPluginOptions['budget'];
let walletAuth: ReturnType<typeof createWalletAuth> | undefined;
const walletRequired = (auth?: import('@tcg/contracts').AuthContext) => { if (!auth?.walletAddress) throw new AppError('UNAUTHORIZED', '예산 설정과 구매에는 지갑 로그인이 필요합니다.', 401); return auth; };
const localAgent = createLocalAgentOptions(env, process.env, { purchase: async input => {
  if (!demoPurchase) throw new AppError('PAYMENT_UNAVAILABLE', '거래 데모가 연결되지 않았습니다.', 503);
  walletRequired(input.auth);
  return demoPurchase(input);
}, budget: {
  async propose(patch, auth) { if (!agentBudget) throw new AppError('POLICY_VIOLATION', '예산 설정이 연결되지 않았습니다.', 503); return agentBudget.propose(patch, walletRequired(auth)); },
  async confirm(proposal, auth) { if (!agentBudget) throw new AppError('POLICY_VIOLATION', '예산 설정이 연결되지 않았습니다.', 503); return agentBudget.confirm(proposal, walletRequired(auth)); },
} });
const demoAuth = createDemoAuthResolver(env);
const app = await buildApp({
  paymentOptions,
  env,
  logger: true,
  async resolveAuth(request) {
    return await walletAuth?.resolveAuth(request.headers.authorization) ?? await localAgent.resolveAuth?.(request) ?? await demoAuth(request);
  },
  async createIntegrationPlugins(deps) {
    if (deps.prisma) walletAuth = createWalletAuth({ prisma: deps.prisma, origin: env.AUTH_WEB_ORIGIN ?? `http://127.0.0.1:${process.env.PORT ?? '3000'}`, allowLocalhostAlias: env.NODE_ENV !== 'production' && !env.AUTH_WEB_ORIGIN, chainId: env.PAYMENT_CHAIN === 'maroo' ? 450815 : 84532, ownerAddress: browserWallet });
    const plugins = await createIntegrationPlugins(deps, { rwaVariables: process.env, signAgentPayment: agentWallet?.sign, onDemoPurchaseReady: handler => { demoPurchase = handler; }, onAgentBudgetReady: handler => { agentBudget = handler; } });
    const agentPlugins = await localAgent.createIntegrationPlugins?.(deps) ?? [];
    return [...(walletAuth ? [walletAuth.plugin] : []), ...plugins, ...agentPlugins];
  },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
}
try { await app.listen({ host: env.API_HOST, port: env.API_PORT }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
