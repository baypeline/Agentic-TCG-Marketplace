import type { FastifyPluginAsync } from 'fastify';
import { createMcpPlugin } from '@tcg/mcp-server';
import { createMockTradingStore, createPrismaTradingStore, createTradingPlugin, createTradingService } from '@tcg/trading';
import { requireAuth, type IntegrationDependencies } from './app.js';

// 통합 순서는 Trading → Payment → MCP. 실결제 증빙 연결은 후속 단계에서 주입한다.
export async function createIntegrationPlugins({ env, prisma, aggregatorService, valuationService, tradingExecutionContext }: IntegrationDependencies): Promise<FastifyPluginAsync[]> {
  const tradingService = createTradingService({
    store: env.TRADING_DATA_SOURCE === 'database' ? createPrismaTradingStore(prisma!) : createMockTradingStore(),
    executionContext: tradingExecutionContext,
    valuationService,
  });
  const tradingPlugin: FastifyPluginAsync = async app => {
    await app.register(createTradingPlugin({ tradingService, requireAuth }), { prefix: '/api' });
    let running: Promise<unknown> | undefined;
    const timer = setInterval(() => {
      if (running) return;
      running = tradingService.expireReservations()
        .catch(error => app.log.error({ err: error }, 'Reservation cleanup failed'))
        .finally(() => { running = undefined; });
    }, env.TRADING_SWEEP_INTERVAL_MS);
    timer.unref();
    app.addHook('onClose', async () => {
      clearInterval(timer);
      await running;
    });
  };
  return [tradingPlugin, createMcpPlugin({ aggregatorService, valuationService, getAuth: request => request.auth })];
}
