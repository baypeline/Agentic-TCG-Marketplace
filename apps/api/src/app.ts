import Fastify, { type FastifyPluginAsync, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type AggregatorService, type AuthContext, type ValuationService } from '@tcg/contracts';
import { parseApiEnv, type ApiEnv } from '@tcg/config';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createAggregatorPlugin, createAggregatorService, createMockCardAdapter, createPrismaCardAdapter } from '@tcg/aggregator';
import { createMarketPriceServices, createMockPriceAdapter, createPrismaMockPriceAdapter, createValuationPlugin, createValuationService } from '@tcg/valuation';

declare module 'fastify' { interface FastifyRequest { auth: AuthContext | null } }
export interface IntegrationDependencies {
  env: ApiEnv;
  prisma: PrismaClient | null;
  aggregatorService: AggregatorService;
  valuationService: ValuationService;
}
export interface AppOptions {
  env?: ApiEnv;
  logger?: boolean;
  resolveAuth?: (request: FastifyRequest) => Promise<AuthContext | null>;
  // Trading → Payment → MCP 생성·주입은 통합 단계에서 이 팩토리에 구성한다.
  createIntegrationPlugins?: (deps: IntegrationDependencies) => Promise<FastifyPluginAsync[]>;
}
export function requireAuth(request: FastifyRequest): AuthContext {
  if (!request.auth) throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
  return request.auth;
}
export async function buildApp(options: AppOptions = {}) {
  const env = options.env ?? parseApiEnv(process.env);
  const app = Fastify({ logger: options.logger ?? false });
  app.decorateRequest('auth', null);
  app.addHook('onRequest', async request => { request.auth = await options.resolveAuth?.(request) ?? null; });
  app.setErrorHandler((error, request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '요청 형식을 확인하세요.', retryable: false }, requestId: request.id });
    if (error instanceof AppError) return reply.code(error.statusCode).send({ error: { code: error.code, message: error.message, retryable: error.retryable }, requestId: request.id });
    if (error instanceof Error && 'statusCode' in error && error.statusCode === 400) return reply.code(400).send({ error: { code: 'VALIDATION_ERROR', message: '잘못된 요청입니다.', retryable: false }, requestId: request.id });
    request.log.error({ err: error }, 'Request failed');
    return reply.code(500).send({ error: { code: 'INTERNAL_ERROR', message: '서버 처리 중 오류가 발생했습니다.', retryable: false }, requestId: request.id });
  });
  // DB lifecycle은 호스트가 소유. Mock 모드에서는 연결을 요구하지 않는다.
  const prisma = env.DATABASE_ENABLED ? createPrismaClient(env.DATABASE_URL!) : null;
  if (prisma) {
    app.addHook('onClose', async () => { await prisma.$disconnect(); });
  }
  try {
    if (prisma) await prisma.$connect();
    const useDatabase = env.CARD_DATA_SOURCE === 'database';
    const aggregatorService = createAggregatorService({ adapter: useDatabase ? createPrismaCardAdapter(prisma!) : createMockCardAdapter() });
    const market = useDatabase ? createMarketPriceServices({ prisma: prisma! }) : null;
    const valuationService = createValuationService({ aggregatorService, adapter: env.PRICE_DATA_SOURCE === 'market' ? market!.adapter : useDatabase ? createPrismaMockPriceAdapter(prisma!) : createMockPriceAdapter() });
    const marketPriceService = market?.marketPriceService ?? { async getPrices(id: string) {
      if (!await aggregatorService.getCardVariant(id)) throw new AppError('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.', 404);
      return { cardVariantId: id, dataSource: 'MARKET' as const, items: [], maxAgeHours: 72, evaluatedAt: new Date().toISOString() };
    } };
    const plugins = await options.createIntegrationPlugins?.({ env, prisma, aggregatorService, valuationService }) ?? [];
    app.get('/health', async () => ({ status: 'ok', dataMode: env.DATA_MODE, cardDataSource: env.CARD_DATA_SOURCE, priceDataSource: env.PRICE_DATA_SOURCE, tradingDataSource: env.TRADING_DATA_SOURCE, database: prisma ? 'connected' : 'disabled' }));
    await app.register(createAggregatorPlugin({ aggregatorService }), { prefix: '/api' });
    await app.register(createValuationPlugin({ valuationService, marketPriceService }), { prefix: '/api' });
    for (const plugin of plugins) await app.register(plugin);
    await app.ready();
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
}
