import Fastify from 'fastify';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { AppError } from '@tcg/contracts';
import { createWalletAuth } from '../src/wallet-auth.js';
import { demoBuyerId } from '../src/demo-auth.js';

it.skipIf(!process.env.DATABASE_TEST_URL)('설정된 기존 구매자 지갑만 데모 소유권과 서버 지갑 권한에 연결한다', async () => {
  const db = createPrismaClient(process.env.DATABASE_TEST_URL!), owner = privateKeyToAccount(generatePrivateKey());
  const origin = 'http://127.0.0.1:3000', address = owner.address.toLowerCase(), binding = 'c'.repeat(64);
  const app = Fastify();
  const before = await db.spendingPolicy.findMany({ where: { userId: demoBuyerId } });
  try {
    await app.register(createWalletAuth({ prisma: db, origin, chainId: 450815, ownerAddress: owner.address }).plugin);
    const challenge = (await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin }, payload: { address, binding } })).json();
    const signature = await owner.signMessage({ message: challenge.message });
    const response = await app.inject({ method: 'POST', url: '/api/auth/verify', headers: { origin }, payload: { challengeId: challenge.id, binding, signature } });
    expect(response.statusCode).toBe(200);
    expect(response.json().user).toMatchObject({ userId: demoBuyerId, agentWalletLinked: true });
    const changedOwner = createWalletAuth({ prisma: db, origin, chainId: 450815, ownerAddress: `0x${'9'.repeat(40)}` });
    await expect(changedOwner.resolveAuth(`Bearer ${response.json().token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    expect(await db.spendingPolicy.findMany({ where: { userId: demoBuyerId } })).toEqual(before);
  } finally {
    await app.close(); await db.walletSession.deleteMany({ where: { address } }); await db.walletChallenge.deleteMany({ where: { address } }); await db.walletIdentity.deleteMany({ where: { address } }); await db.$disconnect();
  }
});

it.skipIf(!process.env.DATABASE_TEST_URL)('실제 지갑 서명·브라우저 바인딩·재사용 방지·영속 세션·만료·사용자 분리를 검증한다', async () => {
  const db = createPrismaClient(process.env.DATABASE_TEST_URL!);
  const alice = privateKeyToAccount(generatePrivateKey()), bob = privateKeyToAccount(generatePrivateKey());
  const addresses = [alice.address.toLowerCase(), bob.address.toLowerCase()];
  let time = new Date('2026-11-28T00:00:00Z');
  const origin = 'http://127.0.0.1:3000', binding = 'a'.repeat(64);
  const auth = createWalletAuth({ prisma: db, origin, chainId: 450815, now: () => time });
  const app = Fastify();
  app.setErrorHandler((e, _req, reply) => reply.status(e instanceof AppError ? e.statusCode : 400).send({ message: e instanceof Error ? e.message : 'error' }));
  await app.register(auth.plugin);
  const challengeIds: string[] = [];
  async function challenge(account = alice) {
    const response = await app.inject({ method: 'POST', url: '/api/auth/challenge', headers: { origin }, payload: { address: account.address, binding } });
    expect(response.statusCode).toBe(200); const data = response.json(); challengeIds.push(data.id); return data;
  }
  const verify = (id: string, signature: string, extra: object = {}, requestOrigin = origin) => app.inject({ method: 'POST', url: '/api/auth/verify', headers: { origin: requestOrigin }, payload: { challengeId: id, signature, binding, ...extra } });
  try {
    const first = await challenge(), signature = await alice.signMessage({ message: first.message });
    expect(first.message).toContain('127.0.0.1:3000'); expect(first.message).toContain('Chain ID: 450815');
    expect((await verify(first.id, signature, {}, 'https://evil.test')).statusCode).toBe(403);
    expect((await verify(first.id, signature, { binding: 'b'.repeat(64) })).statusCode).toBe(401);
    expect((await verify(first.id, await bob.signMessage({ message: first.message }))).statusCode).toBe(401);
    const responses = await Promise.all([verify(first.id, signature), verify(first.id, signature)]);
    expect(responses.map(r=>r.statusCode).sort()).toEqual([200,401]);
    const a = responses.find(r=>r.statusCode===200)!.json();
    expect(a.user.agentWalletLinked).toBe(false); expect(a.user.userId).not.toBe(demoBuyerId);
    const stored = await db.walletSession.findFirstOrThrow({ where: { address: addresses[0] } });
    expect(stored.tokenHash).not.toBe(a.token); expect(stored.tokenHash).toHaveLength(64);
    const restarted = createWalletAuth({ prisma: db, origin, chainId: 450815, now: () => time });
    expect(await restarted.resolveAuth(`Bearer ${a.token}`)).toMatchObject({ userId: a.user.userId, agentId: a.user.agentId, walletAddress: addresses[0] });
    const second = await challenge(bob), b = (await verify(second.id, await bob.signMessage({ message: second.message }))).json();
    expect(b.user.userId).not.toBe(a.user.userId); expect(b.user.agentId).not.toBe(a.user.agentId);
    const again = await challenge(), againResult = (await verify(again.id, await alice.signMessage({ message: again.message }))).json();
    expect(againResult.user.userId).toBe(a.user.userId);
    expect((await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin, authorization: `Bearer ${a.token}` } })).statusCode).toBe(200);
    await expect(auth.resolveAuth(`Bearer ${a.token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
    const expires = await challenge(); time = new Date(time.getTime()+6*60_000);
    expect((await verify(expires.id, await alice.signMessage({ message: expires.message }))).statusCode).toBe(401);
    time = new Date(time.getTime()+8*60*60_000);
    await expect(restarted.resolveAuth(`Bearer ${b.token}`)).rejects.toMatchObject({ code: 'UNAUTHORIZED' });
  } finally {
    await app.close();
    await db.walletSession.deleteMany({ where: { address: { in: addresses } } });
    await db.walletChallenge.deleteMany({ where: { id: { in: challengeIds } } });
    await db.walletIdentity.deleteMany({ where: { address: { in: addresses } } });
    await db.$disconnect();
  }
});
