import { config } from 'dotenv';
import { parseApiEnv } from '@tcg/config';
import { buildApp } from './app.js';
import { createIntegrationPlugins } from './integrations.js';
import { createLocalAgentOptions } from './local-agent.js';
import { createX402SettlementAdapter } from '@tcg/payment-server';
import { demoBuyerId, demoBuyerAgentId, createDemoAuthResolver } from './demo-auth.js';

config({ path: '../../.env', quiet: true });
const env = parseApiEnv(process.env);
const getWalletAddress = async (auth: { userId: string; agentId: string }) => auth.userId === demoBuyerId && auth.agentId === demoBuyerAgentId ? env.AGENT_WALLET_ADDRESS ?? null : null;
const paymentOptions = env.PAYMENT_ENABLED ? { recipient: env.PAYMENT_RECIPIENT, getWalletAddress, adapter: createX402SettlementAdapter({ getWalletAddress }) } : undefined;
const localAgent = createLocalAgentOptions(env, process.env);
const demoAuth = createDemoAuthResolver(env);
const app = await buildApp({
  paymentOptions,
  env,
  logger: true,
  async resolveAuth(request) {
    return await localAgent.resolveAuth?.(request) ?? await demoAuth(request);
  },
  async createIntegrationPlugins(deps) {
    const plugins = await createIntegrationPlugins(deps);
    const agentPlugins = await localAgent.createIntegrationPlugins?.(deps) ?? [];
    return [...plugins, ...agentPlugins];
  },
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
}
try { await app.listen({ host: env.API_HOST, port: env.API_PORT }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
