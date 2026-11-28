import Fastify from 'fastify';
import { expect, it, vi } from 'vitest';
import type { PrismaClient } from '@tcg/db';
import { createFacilitatorPayersPlugin } from '../src/facilitator-payers.js';

it('서비스 토큰으로 현재 등록된 주소만 확인하고 키나 사용자 정보를 반환하지 않는다', async () => {
  const address = `0x${'a'.repeat(40)}`, token = 't'.repeat(32);
  const findUnique = vi.fn().mockResolvedValue({ address });
  const db = { managedAgentWallet: { findUnique } } as unknown as Pick<PrismaClient, 'managedAgentWallet'>;
  const app = Fastify();
  try {
    await app.register(createFacilitatorPayersPlugin(db, token));
    const call = (authorization?: string) => app.inject({ method: 'POST', url: '/internal/facilitator/payers/check', headers: authorization ? { authorization } : {}, payload: { address: address.toUpperCase().replace('0X', '0x') } });
    expect((await call()).statusCode).toBe(401);
    expect((await call(`Bearer ${'x'.repeat(32)}`)).statusCode).toBe(401);
    expect(findUnique).not.toHaveBeenCalled();
    expect((await call(`Bearer ${token}`)).json()).toEqual({ address, allowed: true });
    expect(findUnique).toHaveBeenLastCalledWith({ where: { address }, select: { address: true } });
    findUnique.mockResolvedValueOnce(null);
    expect((await call(`Bearer ${token}`)).json()).toEqual({ address, allowed: false });
  } finally { await app.close(); }
});
