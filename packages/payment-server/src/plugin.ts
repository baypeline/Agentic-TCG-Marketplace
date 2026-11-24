import { AppError, idSchema, mutationContextSchema, type AuthContext, type TradingBuyer } from '@tcg/contracts';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { PolicyService } from './policies.js';
import type { PaymentService } from './service.js';

export function createCommercePlugin({ policies, payments, requireAuth }: { policies: PolicyService; payments: PaymentService; requireAuth(request: FastifyRequest): AuthContext }): FastifyPluginAsync {
  return async app => {
    const buyer = (request: FastifyRequest): TradingBuyer => { const auth = requireAuth(request); if (!auth.agentId) throw new AppError('FORBIDDEN', '인증된 Agent가 필요합니다.', 403); return { userId: auth.userId, agentId: auth.agentId }; };
    const id = (request: FastifyRequest) => idSchema.parse((request.params as { id: string }).id);
    const mutation = (request: FastifyRequest) => mutationContextSchema.parse({ idempotencyKey: request.headers['idempotency-key'] });
    app.get('/policies', async request => policies.list(buyer(request)));
    app.post('/policies', async (request, reply) => reply.code(201).send(await policies.create(buyer(request), request.body, mutation(request))));
    app.get('/policies/:id', async request => policies.get(buyer(request), id(request)));
    app.put('/policies/:id', async request => policies.update(buyer(request), id(request), request.body, mutation(request)));
    app.get('/policies/:id/budget', async request => policies.budget(buyer(request), id(request)));
    app.get('/policies/:id/versions', async request => policies.versions(buyer(request), id(request)));
    app.get('/purchases/:id/status', async request => payments.getPaymentStatus(id(request), buyer(request)));
  };
}
