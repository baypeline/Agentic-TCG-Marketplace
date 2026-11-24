import { AppError, cardParamsSchema, mutationContextSchema, type AuthContext } from '@tcg/contracts';
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
    const mutation = (request: FastifyRequest) => mutationContextSchema.parse({ idempotencyKey: request.headers['idempotency-key'] });
    app.get('/inventory', async request => tradingService.listInventory(await requireAuth(request)));
    app.get('/listings', async request => tradingService.listListings(listingQuerySchema.parse(request.query)));
    app.get('/listings/lowest/:id', async (request, reply) =>
      reply.type('application/json').send(await tradingService.findLowestListing(cardParamsSchema.parse(request.params).id)));
    app.post('/listings', async (request, reply) => {
      const listing = await tradingService.createListing(await requireAuth(request), listingInputSchema.parse(request.body), mutation(request));
      return reply.code(201).send(listing);
    });
    app.delete('/listings/:id', async request =>
      tradingService.cancelListing(await requireAuth(request), cardParamsSchema.parse(request.params).id));
    app.get('/listings/:id', async request => tradingService.getListing(cardParamsSchema.parse(request.params).id));
    app.get('/buy-orders', async request => tradingService.listBuyOrders(await requireBuyer(request)));
    app.post('/buy-orders', async (request, reply) => {
      const order = await tradingService.createBuyOrder(await requireBuyer(request), orderInputSchema.parse(request.body), mutation(request));
      return reply.code(201).send(order);
    });
    app.delete('/buy-orders/:id', async request =>
      tradingService.cancelBuyOrder(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
    app.post('/buy-orders/:id/cancel', async request =>
      tradingService.cancelBuyOrder(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
    app.post('/buy-orders/:id/pause', async request =>
      tradingService.pauseBuyOrder(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
    app.post('/buy-orders/:id/resume', async request =>
      tradingService.resumeBuyOrder(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
    app.post('/buy-orders/:id/match', async (request, reply) =>
      reply.type('application/json').send(await tradingService.matchBuyOrder(
        await requireBuyer(request), cardParamsSchema.parse(request.params).id, mutation(request),
      )));
    for (const path of ['/purchases/fixed/quote', '/quotes/fixed']) {
      app.post(path, async request => tradingService.quoteFixedPurchase(await requireBuyer(request), fixedInputSchema.parse(request.body), mutation(request)));
    }
    for (const path of ['/purchases/market/quote', '/quotes/market']) {
      app.post(path, async (request, reply) => reply.type('application/json').send(await tradingService.quoteMarketPurchase(
        await requireBuyer(request), marketInputSchema.parse(request.body), mutation(request),
      )));
    }
    app.get('/matches', async request => tradingService.listMatches(await requireBuyer(request)));
    app.get('/seller-proceeds', async request => tradingService.sellerProceeds(await requireAuth(request)));
    app.get('/matches/:id', async request => tradingService.getMatch(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
    app.get('/trades', async request => tradingService.listTrades(await requireAuth(request)));
    app.get('/trades/:id', async request => tradingService.getTrade(await requireAuth(request), cardParamsSchema.parse(request.params).id));
    app.delete('/quotes/:id', async request =>
      tradingService.releaseQuote(await requireBuyer(request), cardParamsSchema.parse(request.params).id));
  };
}
