import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '@tcg/contracts';
import { createMcpPlugin } from '@tcg/mcp-server';
import { createServerRunPlugin, type AgentSessionPluginOptions } from '@tcg/agent';
import { createDemoPurchaseHandler } from './demo-purchase.js';
import { createCommercePlugin, createPaymentEvidenceReader, createPaymentService, createPolicyService, getPolicyExecutionContext } from '@tcg/payment-server';
import { createMockTradingStore, createPrismaTradingStore, createTradingPlugin, createTradingService, type TradingService } from '@tcg/trading';
import { requireAuth, type IntegrationDependencies } from './app.js';

export async function createIntegrationPlugins({ env, prisma, aggregatorService, valuationService, tradingExecutionContext, paymentOptions, executeAgentRun }: IntegrationDependencies, options: { onDemoPurchaseReady?: (handler: NonNullable<AgentSessionPluginOptions['purchase']>) => void } = {}): Promise<FastifyPluginAsync[]> {
  const store = env.TRADING_DATA_SOURCE === 'database' ? createPrismaTradingStore(prisma!) : createMockTradingStore();
  let trading: TradingService;
  const policies = createPolicyService({ store, onInactive: auth => trading.pauseAgentOrders(auth) });
  trading = createTradingService({ store, payment: createPaymentEvidenceReader(store), valuationService,
    executionContext: tradingExecutionContext,
    // Tests/custom hosts may inject a trusted reader. Production uses the shared transaction.
    executionInTransaction: tradingExecutionContext ? undefined : getPolicyExecutionContext,
  });
  const payments = createPaymentService({ ...paymentOptions, store, tradingService: trading, valuationService });
  const plugin: FastifyPluginAsync = async app => {
    if (env.DEMO_SCENARIOS_ENABLED) options.onDemoPurchaseReady?.(createDemoPurchaseHandler({ env, trading, policies, getMcpUrl: () => {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new AppError('PAYMENT_UNAVAILABLE', 'MCP 서버가 수신 중이 아닙니다.', 503);
      return `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}/mcp`;
    } }));
    app.get('/api/me', async request => { const { userId, agentId } = requireAuth(request); return { userId, ...(agentId ? { agentId } : {}) }; });
    await app.register(createTradingPlugin({ tradingService: trading, requireAuth }), { prefix: '/api' });
    await app.register(createCommercePlugin({ policies, payments, requireAuth }), { prefix: '/api' });
    await app.register(createServerRunPlugin({ runs: policies, requireAuth, execute: executeAgentRun }));
    let running: Promise<unknown> | undefined;
    const sweep = async () => { await policies.expireRuns(); await trading.expireReservations(); await payments.recover(); };
    const timer = setInterval(() => { if (!running) running = sweep().catch(error => app.log.error({ err: error }, 'Marketplace recovery failed')).finally(() => { running = undefined; }); }, env.TRADING_SWEEP_INTERVAL_MS);
    timer.unref();
    app.addHook('onClose', async () => { clearInterval(timer); await running; });
  };
  return [plugin, createMcpPlugin({ aggregatorService, valuationService, tradingService: trading, paymentService: payments, getAuth: request => request.auth })];
}
