import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import { AppError, type SpendingPolicy } from '@tcg/contracts';
import { createMockTradingStore, createTradingService, demoInventory, demoSellerId } from '@tcg/trading';
import { createAgentExecutionController, createAgentSessionPlugin } from '../src/index.js';

const buyer = { userId: randomUUID(), agentId: randomUUID() };
const policy: SpendingPolicy = { agentId: buyer.agentId, enabled: true, totalBudget: '100000000', maxPerTrade: '20000000', validUntil: '2099-01-01T00:00:00.000Z' };
const key = () => ({ idempotencyKey: randomUUID() });

it('실제 세션 중단을 Trading의 미제출 주문 중지에 연결하고 제출된 결제는 유지한다', async () => {
  let trading: ReturnType<typeof createTradingService>;
  const controller = createAgentExecutionController({ resolvePolicy: async () => policy, pauseOrders: auth => trading.pauseAgentOrders(auth) });
  trading = createTradingService({ store: createMockTradingStore(), executionContext: controller.executionContext });
  const app = Fastify();
  app.setErrorHandler((error, _request, reply) => error instanceof AppError ? reply.code(error.statusCode).send({ code: error.code }) : reply.send(error));
  await app.register(createAgentSessionPlugin({ runtime: { async runAgentTurn() { return 'ok'; } }, requireAuth: () => buyer, ...controller }), { prefix: '/api' });
  try {
    const card = demoInventory[0]!;
    await trading.createListing({ userId: demoSellerId }, { inventoryItemId: card.id, price: '10000000' }, key());
    const order = await trading.createBuyOrder(buyer, { cardVariantId: card.cardVariantId, maxPrice: '10000000', expiresAt: '2098-01-01T00:00:00.000Z' }, key());
    await expect(trading.matchBuyOrder(buyer, order.id)).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
    const started = await app.inject({ method: 'POST', url: '/api/agent/sessions' });
    expect(started.statusCode).toBe(201);
    const quote = (await trading.matchBuyOrder(buyer, order.id))!;
    expect((await app.inject({ method: 'POST', url: `/api/agent/sessions/${started.json().id}/stop` })).statusCode).toBe(200);
    expect(await trading.getMatch(buyer, quote.id)).toMatchObject({ status: 'RELEASED' });
    expect(await trading.listBuyOrders(buyer)).toMatchObject([{ status: 'PAUSED' }]);
    const resumed = await app.inject({ method: 'POST', url: '/api/agent/sessions' });
    await trading.resumeBuyOrder(buyer, order.id);
    const pending = (await trading.matchBuyOrder(buyer, order.id))!;
    await trading.beginPayment(pending.id, randomUUID());
    await app.inject({ method: 'POST', url: `/api/agent/sessions/${resumed.json().id}/stop` });
    expect(await trading.getMatch(buyer, pending.id)).toMatchObject({ status: 'PAYMENT_PENDING' });
  } finally { await app.close(); }
});

it('정책을 매번 재검증하고 마지막 세션이 중단될 때만 주문을 정리한다', async () => {
  let approved = true;
  const pauseOrders = vi.fn(async () => {});
  const controller = createAgentExecutionController({ resolvePolicy: async () => approved ? policy : null, pauseOrders });
  await controller.onSessionStarted(buyer, 'first');
  await controller.onSessionStarted(buyer, 'second');
  await controller.onSessionStopped(buyer, 'first');
  expect(pauseOrders).not.toHaveBeenCalled();
  expect(await controller.executionContext.getExecutionContext(buyer)).toMatchObject({ online: true });
  approved = false;
  expect(await controller.executionContext.getExecutionContext(buyer)).toBeNull();
  await expect(controller.onSessionStarted(buyer, 'third')).rejects.toMatchObject({ code: 'POLICY_VIOLATION' });
  await controller.onSessionStopped(buyer, 'second');
  expect(pauseOrders).toHaveBeenCalledExactlyOnceWith(buyer);
});

it('주문 중지 실패 중에도 offline을 유지하며 같은 중단을 재시도할 수 있다', async () => {
  const pauseOrders = vi.fn().mockRejectedValueOnce(new Error('temporary DB failure')).mockResolvedValueOnce([]);
  const controller = createAgentExecutionController({ resolvePolicy: async () => policy, pauseOrders });
  await controller.onSessionStarted(buyer, 'only');
  await expect(controller.onSessionStopped(buyer, 'only')).rejects.toThrow('temporary');
  expect(await controller.executionContext.getExecutionContext(buyer)).toBeNull();
  await controller.onSessionStopped(buyer, 'only');
  expect(pauseOrders).toHaveBeenCalledTimes(2);
});
