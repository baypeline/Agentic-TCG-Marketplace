import { randomUUID } from 'node:crypto';
import { AppError, listingSchema, matchQuoteSchema } from '@tcg/contracts';
import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { ZodError } from 'zod';
import { createMockTradingStore, createTradingPlugin, createTradingService, demoInventory, demoSellerId } from '../src/index.js';

it('serves direct DTOs and uses the auth supplied by the host', async () => {
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof AppError) return reply.code(error.statusCode).send({ code: error.code });
    if (error instanceof ZodError) return reply.code(400).send({ code: 'VALIDATION_ERROR' });
    return reply.send(error);
  });
  const buyer = { userId: randomUUID(), agentId: randomUUID() };
  const card = demoInventory[0]!;
  try {
    await app.register(createTradingPlugin({
      tradingService: createTradingService({ store: createMockTradingStore() }),
      requireAuth(request) {
        if (request.headers.authorization === 'seller-test-token') return { userId: demoSellerId };
        if (request.headers.authorization === 'buyer-test-token') return buyer;
        throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
      },
    }), { prefix: '/api' });
    const payload = { inventoryItemId: card.id, price: '10000000' };
    const unauthorized = await app.inject({ method: 'POST', url: '/api/listings', payload, headers: { 'x-user-id': demoSellerId } });
    expect(unauthorized.statusCode).toBe(401);
    const sellerHeaders = { authorization: 'seller-test-token' };
    const buyerHeaders = { authorization: 'buyer-test-token' };
    const invalid = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload: { ...payload, price: '1.5' } });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject(`/api/listings/lowest/${card.cardVariantId}`)).json()).toBeNull();
    const created = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload });
    expect(created.statusCode).toBe(201);
    const listing = listingSchema.parse(created.json());
    expect((await app.inject('/api/listings')).json()).toEqual([listing]);
    const quote = await app.inject({
      method: 'POST', url: '/api/quotes/fixed', headers: buyerHeaders,
      payload: { listingId: listing.id, maxPrice: payload.price, buyerAgentId: randomUUID() },
    });
    expect(matchQuoteSchema.parse(quote.json()).buyerAgentId).toBe(buyer.agentId);
    expect((await app.inject('/api/listings')).json()).toEqual([]);
  } finally {
    await app.close();
  }
});
