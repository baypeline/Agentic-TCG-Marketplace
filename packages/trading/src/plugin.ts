import { AppError, cardParamsSchema, type AuthContext } from '@tcg/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import {
  fixedInputSchema, listingInputSchema, listingQuerySchema, marketInputSchema, orderInputSchema,
  type TradingService,
} from './service.js';

export interface TradingPluginOptions {
  tradingService: TradingService;
  requireAuth(request: FastifyRequest): AuthContext | Promise<AuthContext>;
}

export function createTradingPlugin({ tradingService, requireAuth }: TradingPluginOptions): FastifyPluginAsync {
  async function requireBuyer(request: FastifyRequest) {
    const auth = await requireAuth(request);
    if (!auth.agentId) throw new AppError('FORBIDDEN', '인증된 Agent가 필요합니다.', 403);
    return { userId: auth.userId, agentId: auth.agentId };
  }

  return async app => {
    app.get('/inventory', async request => tradingService.listInventory(await requireAuth(request)));
    app.get('/listings', async request => tradingService.listListings(listingQuerySchema.parse(request.query)));
    app.get('/listings/lowest/:id', async (request, reply) =>
      reply.type('application/json').send(await tradingService.findLowestListing(cardParamsSchema.parse(request.params).id)));
    app.post('/listings', async (request, reply) => {
      const listing = await tradingService.createListing(await requireAuth(request), listingInputSchema.parse(request.body));
      return reply.code(201).send(listing);
    });
    app.delete('/listings/:id', async request =>
      tradingService.cancelListing(await requireAuth(request), cardParamsSchema.parse(request.params).id));
    app.get('/buy-orders', async request => tradingService.listBuyOrders(await requireBuyer(request)));
    app.post('/buy-orders', async (request, reply) => {
      const order = await tradingService.createBuyOrder(await requireBuyer(request), orderInputSchema.parse(request.body));
      return reply.code(201).send(order);
    });
    app.delete('/buy-orders/:id', async request =>
      tradingService.cancelBuyOrder(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
    app.post('/buy-orders/:id/match', async (request, reply) =>
      reply.type('application/json').send(await tradingService.matchBuyOrder(
        await requireBuyer(request), cardParamsSchema.parse(request.params).id,
      )));
    app.post('/quotes/fixed', async request =>
      tradingService.quoteFixedPurchase(await requireBuyer(request), fixedInputSchema.parse(request.body)));
    app.post('/quotes/market', async (request, reply) =>
      reply.type('application/json').send(await tradingService.quoteMarketPurchase(
        await requireBuyer(request), marketInputSchema.parse(request.body),
      )));
    app.delete('/quotes/:id', async request =>
      tradingService.releaseQuote(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
  };
}
