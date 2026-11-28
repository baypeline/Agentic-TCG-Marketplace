import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@tcg/db';
import { z } from 'zod';

export function createFacilitatorPayersPlugin(prisma: Pick<PrismaClient, 'managedAgentWallet'>, token: string): FastifyPluginAsync {
  if (token.length < 32) throw new Error('퍼실리테이터 인증 설정을 확인하세요.');
  const expected = Buffer.from(`Bearer ${token}`);
  return async app => {
    app.post('/internal/facilitator/payers/check', async (request, reply) => {
      const received = Buffer.from(request.headers.authorization ?? '');
      if (received.length !== expected.length || !timingSafeEqual(received, expected)) return reply.code(401).send({ error: 'unauthorized' });
      const { address } = z.object({ address: z.string().regex(/^0x[\da-fA-F]{40}$/) }).strict().parse(request.body);
      const row = await prisma.managedAgentWallet.findUnique({ where: { address: address.toLowerCase() }, select: { address: true } });
      return reply.header('Cache-Control', 'no-store').send({ address: address.toLowerCase(), allowed: !!row });
    });
  };
}
