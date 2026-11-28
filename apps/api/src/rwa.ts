import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';
import type { RwaService } from '@tcg/rwa';
import { requireAuth } from './app.js';
import { rwaViewSchema, rwaActionSchema } from '@tcg/contracts';
const inputSchema = z.object({ kind: z.enum(['approve-nft','list','cancel-listing','redeem','cancel-redemption','approve-release','abort-release','finalize-redemption','withdraw']), assetId: z.uuid().optional(), listingId: z.uuid().optional(), redemptionId: z.string().regex(/^0x[\da-fA-F]{64}$/).optional(), price: z.string().regex(/^[1-9]\d{0,77}$/).optional() }).strict();
export function createRwaPlugin(rwa: RwaService): FastifyPluginAsync { return async app => {
  app.get('/api/rwa', async req => rwaViewSchema.parse(await rwa.view(requireAuth(req).userId)));
  app.post('/api/rwa/actions', async req => rwaActionSchema.parse(await rwa.action(requireAuth(req).userId, z.uuid().parse(req.headers['idempotency-key']), inputSchema.parse(req.body).kind, inputSchema.parse(req.body))));
  app.get('/api/rwa/actions/:id', async req => rwaActionSchema.parse(await rwa.status(requireAuth(req).userId,z.object({id:z.uuid()}).parse(req.params).id)));
}; }
