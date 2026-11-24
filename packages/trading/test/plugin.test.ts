import { randomUUID } from 'node:crypto';
import { allowExecution } from './helpers.js';
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
      tradingService: createTradingService({ store: createMockTradingStore(), executionContext: allowExecution }),
      requireAuth(request) {
        if (request.headers.authorization === 'seller-test-token') return { userId: demoSellerId };
        if (request.headers.authorization === 'buyer-test-token') return buyer;
        throw new AppError('UNAUTHORIZED', 'Authentication required.', 401);
      },
    }), { prefix: '/api' });
    const payload = { inventoryItemId: card.id, price: '10000000' };
    const unauthorized = await app.inject({ method: 'POST', url: '/api/listings', payload, headers: { 'x-user-id': demoSellerId } });
    expect(unauthorized.statusCode).toBe(401);
    const sellerHeaders = { authorization: 'seller-test-token', 'idempotency-key': randomUUID() };
    const buyerHeaders = { authorization: 'buyer-test-token', 'idempotency-key': randomUUID() };
    const invalid = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload: { ...payload, price: '1.5' } });
    expect(invalid.statusCode).toBe(400);
    expect((await app.inject(`/api/listings/lowest/${card.cardVariantId}`)).json()).toBeNull();
    const created = await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload });
    expect(created.statusCode).toBe(201);
    const listing = listingSchema.parse(created.json());
    expect((await app.inject(`/api/listings/${listing.id}`)).json()).toEqual(listing);
    expect((await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload })).json()).toEqual(listing);
    expect((await app.inject({ method: 'POST', url: '/api/listings', headers: sellerHeaders, payload: { ...payload, price: '1' } })).statusCode).toBe(409);
    expect((await app.inject({ method: 'POST', url: '/api/listings', headers: { authorization: 'seller-test-token' }, payload })).statusCode).toBe(400);
    const order = await app.inject({ method: 'POST', url: '/api/buy-orders', headers: buyerHeaders, payload: { cardVariantId: card.cardVariantId, maxPrice: payload.price, expiresAt: '2098-01-01T00:00:00.000Z' } });
    const orderUrl = `/api/buy-orders/${order.json().id}`;
    expect(order.statusCode).toBe(201);
    expect((await app.inject({ method: 'POST', url: `${orderUrl}/pause`, headers: buyerHeaders })).json().status).toBe('PAUSED');
    expect((await app.inject({ method: 'POST', url: `${orderUrl}/resume`, headers: buyerHeaders })).json().status).toBe('ACTIVE');
    expect((await app.inject({ method: 'POST', url: `${orderUrl}/cancel`, headers: buyerHeaders })).json().status).toBe('CANCELLED');
    expect((await app.inject({ url: '/api/trades', headers: buyerHeaders })).json()).toEqual([]);
    expect((await app.inject({ url: `/api/trades/${randomUUID()}`, headers: buyerHeaders })).statusCode).toBe(404);
    expect((await app.inject('/api/listings')).json()).toEqual([listing]);
    const quote = await app.inject({
      method: 'POST', url: '/api/purchases/fixed/quote', headers: buyerHeaders,
      payload: { listingId: listing.id, maxPrice: payload.price, buyerAgentId: randomUUID() },
    });
    expect(matchQuoteSchema.parse(quote.json()).buyerAgentId).toBe(buyer.agentId);
    expect((await app.inject({ url: `/api/matches/${quote.json().id}`, headers: buyerHeaders })).json()).toEqual(quote.json());
    expect((await app.inject('/api/listings')).json()).toEqual([]);
  } finally {
    await app.close();
  }
});
