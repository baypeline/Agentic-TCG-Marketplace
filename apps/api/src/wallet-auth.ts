import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { getAddress, verifyMessage } from 'viem';
import { createSiweMessage, generateSiweNonce, parseSiweMessage } from 'viem/siwe';
import { z } from 'zod';
import { AppError, type AuthContext } from '@tcg/contracts';
import type { PrismaClient } from '@tcg/db';
import type { FastifyPluginAsync } from 'fastify';
import { demoBuyerId, demoBuyerAgentId } from './demo-auth.js';

const addressSchema = z.string().regex(/^0x[\da-fA-F]{40}$/);
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
const denied = () => new AppError('UNAUTHORIZED', '지갑 로그인 서명 또는 세션을 확인해 주세요.', 401);
export function createWalletAuth({ prisma, origin, chainId, ownerAddress, allowLocalhostAlias = false, now = () => new Date(), provisionAgentWallet }: { prisma: PrismaClient; origin: string; chainId: number; ownerAddress?: string; allowLocalhostAlias?: boolean; now?: () => Date; provisionAgentWallet?: (db: Pick<PrismaClient, 'managedAgentWallet'>, actor: { userId: string; agentId: string }) => Promise<{ address: string }> }) {
  const site = new URL(origin);
  if (site.origin !== origin || !['http:', 'https:'].includes(site.protocol)) throw new Error('AUTH_WEB_ORIGIN에는 경로 없는 웹 Origin이 필요합니다.');
  const linked = (address: string) => !!ownerAddress && address.toLowerCase() === ownerAddress.toLowerCase();
  async function session(token: string | undefined) {
    if (!token || !/^wallet_[a-f0-9]{64}$/.test(token)) return null;
    const row = await prisma.walletSession.findUnique({ where: { tokenHash: hash(token) } });
    return row && !row.revokedAt && row.expiresAt > now() && (row.userId !== demoBuyerId || linked(row.address)) ? row : null;
  }
  const user = async (row: NonNullable<Awaited<ReturnType<typeof session>>>) => {
    const wallet = await provisionAgentWallet?.(prisma, row);
    return { userId: row.userId, agentId: row.agentId, address: getAddress(row.address), expiresAt: row.expiresAt.toISOString(), agentWalletLinked: !!wallet || row.userId === demoBuyerId && linked(row.address), ...(wallet ? { agentWalletAddress: getAddress(wallet.address) } : {}) };
  };
  return {
    async resolveAuth(authorization?: string): Promise<AuthContext | null> {
      if (!authorization?.startsWith('Bearer wallet_')) return null;
      const row = await session(authorization.slice(7));
      if (!row) throw denied();
      return { userId: row.userId, agentId: row.agentId, walletAddress: row.address };
    },
    plugin: (async app => {
      const requireOrigin = (value: string | undefined) => {
        if (value === origin) return site;
        const candidate = value ? URL.parse(value) : null;
        const loopback = new Set(['localhost', '127.0.0.1']);
        if (allowLocalhostAlias && candidate && candidate.origin === value && loopback.has(site.hostname) && loopback.has(candidate.hostname) && candidate.protocol === site.protocol && candidate.port === site.port) return candidate;
        throw new AppError('FORBIDDEN', '등록된 웹 화면에서 로그인해 주세요. 웹 주소와 AUTH_WEB_ORIGIN 설정을 확인하세요.', 403);
      };
      app.post('/api/auth/challenge', async request => {
        const loginSite = requireOrigin(request.headers.origin);
        const input = z.object({ address: addressSchema, binding: z.string().regex(/^[a-f0-9]{64}$/) }).strict().parse(request.body);
        const address = getAddress(input.address), id = randomUUID(), time = now(), expiresAt = new Date(time.getTime() + 5 * 60_000);
        if (await prisma.walletChallenge.count({ where: { consumedAt: null, expiresAt: { gt: time } } }) >= 1000) throw new AppError('POLICY_VIOLATION', '잠시 후 로그인해 주세요.', 429);
        const message = createSiweMessage({ address, domain: loginSite.host, uri: loginSite.origin, version: '1', chainId, nonce: generateSiweNonce(), issuedAt: time, expirationTime: expiresAt, statement: 'Agentic TCG에 로그인합니다. 이 서명은 거래나 송금을 승인하지 않습니다.' });
        await prisma.walletChallenge.create({ data: { id, address: address.toLowerCase(), message, bindingHash: hash(input.binding), expiresAt } });
        return { id, message, chainId, expiresAt: expiresAt.toISOString() };
      });
      app.post('/api/auth/verify', async request => {
        const loginSite = requireOrigin(request.headers.origin);
        const input = z.object({ challengeId: z.uuid(), binding: z.string().regex(/^[a-f0-9]{64}$/), signature: z.string().regex(/^0x[a-fA-F0-9]{130}$/) }).strict().parse(request.body);
        const challenge = await prisma.walletChallenge.findUnique({ where: { id: input.challengeId } });
        if (!challenge || challenge.consumedAt || challenge.expiresAt <= now() || challenge.bindingHash !== hash(input.binding)) throw denied();
        const parsed = parseSiweMessage(challenge.message);
        if (parsed.domain !== loginSite.host || parsed.uri !== loginSite.origin || parsed.chainId !== chainId || parsed.address?.toLowerCase() !== challenge.address) throw denied();
        let valid = false;
        try { valid = await verifyMessage({ address: getAddress(challenge.address), message: challenge.message, signature: input.signature as `0x${string}` }); } catch { /* Invalid EOA signature. */ }
        if (!valid) throw denied();
        const token = `wallet_${randomBytes(32).toString('hex')}`, time = now();
        const row = await prisma.$transaction(async tx => {
          const consumed = await tx.walletChallenge.updateMany({ where: { id: challenge.id, consumedAt: null, expiresAt: { gt: time } }, data: { consumedAt: time } });
          if (consumed.count !== 1) throw denied();
          const identity = await tx.walletIdentity.upsert({ where: { address: challenge.address }, update: { lastLoginAt: time }, create: { address: challenge.address, userId: linked(challenge.address) ? demoBuyerId : randomUUID(), agentId: linked(challenge.address) ? demoBuyerAgentId : randomUUID(), lastLoginAt: time } });
          await provisionAgentWallet?.(tx, identity);
          return tx.walletSession.create({ data: { tokenHash: hash(token), userId: identity.userId, agentId: identity.agentId, address: identity.address, expiresAt: new Date(time.getTime() + 8 * 60 * 60_000) } });
        });
        return { token, user: await user(row) };
      });
      app.get('/api/auth/session', async request => {
        const row = await session(request.headers.authorization?.replace(/^Bearer /, ''));
        if (!row) throw denied();
        return { user: await user(row) };
      });
      app.post('/api/auth/logout', async request => {
        requireOrigin(request.headers.origin);
        const token = request.headers.authorization?.replace(/^Bearer /, '');
        if (token) await prisma.walletSession.updateMany({ where: { tokenHash: hash(token), revokedAt: null }, data: { revokedAt: now() } });
        return { user: null };
      });
      app.addHook('onSend', async (_request, reply) => { reply.header('Cache-Control', 'private, no-store'); });
    }) satisfies FastifyPluginAsync,
  };
}
