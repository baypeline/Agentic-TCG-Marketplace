import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { createPublicClient, http, parseAbi, type Hex } from 'viem';
import { baseSepolia } from 'viem/chains';
import { marooTestnet } from '@tcg/payment-client/native';
import { getPaymentProfile } from '@tcg/contracts/payment-profile';
import { AppError, agentWalletInfoSchema, type AuthContext } from '@tcg/contracts';
import type { PrismaClient } from '@tcg/db';
import type { ApiEnv } from '@tcg/config';
import type { FastifyPluginAsync } from 'fastify';
import { createAgentWallet, type AgentPaymentSigner } from './agent-wallet.js';
import { demoBuyerId, demoBuyerAgentId } from './demo-auth.js';

type Actor = { userId: string; agentId: string };
type WalletDb = Pick<PrismaClient, 'managedAgentWallet'>;
type WalletRow = NonNullable<Awaited<ReturnType<WalletDb['managedAgentWallet']['findUnique']>>>;
const unavailable = () => new AppError('PAYMENT_UNAVAILABLE', '에이전트 지갑을 확인하지 못했습니다. 서버의 암호화 키와 지갑 연결을 확인해 주세요.', 503);
const aad = (row: Pick<WalletRow, 'userId' | 'agentId' | 'address'>) => Buffer.from(`tcg-agent-wallet:v1:${row.userId}:${row.agentId}:${row.address.toLowerCase()}`);
export function createManagedAgentWallets({ prisma, env, encryptionKey, legacyKey, readBalance, signerFactory = createAgentWallet }: { prisma: PrismaClient; env: ApiEnv; encryptionKey: string; legacyKey?: Hex; readBalance?: (address: Hex) => Promise<bigint>; signerFactory?: typeof createAgentWallet }) {
  if (!/^[a-fA-F0-9]{64}$/.test(encryptionKey)) throw new Error('AGENT_WALLET_ENCRYPTION_KEY를 pnpm agent:wallet:key:init으로 설정하세요.');
  const master = Buffer.from(encryptionKey, 'hex'), profile = getPaymentProfile(env.PAYMENT_CHAIN);
  const chain = createPublicClient({ chain: env.PAYMENT_CHAIN === 'maroo' ? marooTestnet : baseSepolia, transport: http(undefined, { timeout: 5_000, retryCount: 0 }) });
  const balanceOf = readBalance ?? (address => env.PAYMENT_CHAIN === 'maroo' ? chain.getBalance({ address }) : chain.readContract({ address: profile.asset as Hex, abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [address] }));
  async function ensure(db: WalletDb, actor: Actor) {
    let row = await db.managedAgentWallet.findUnique({ where: { userId: actor.userId } });
    if (!row) {
      const key = legacyKey && actor.userId === demoBuyerId && actor.agentId === demoBuyerAgentId ? legacyKey : generatePrivateKey();
      const address = privateKeyToAccount(key).address.toLowerCase(), iv = randomBytes(12);
      const owner = { userId: actor.userId, agentId: actor.agentId, address };
      const cipher = createCipheriv('aes-256-gcm', master, iv, { authTagLength: 16 }); cipher.setAAD(aad(owner));
      const ciphertext = Buffer.concat([cipher.update(Buffer.from(key.slice(2), 'hex')), cipher.final()]).toString('hex');
      await db.managedAgentWallet.createMany({ data: [{ ...owner, ciphertext, iv: iv.toString('hex'), authTag: cipher.getAuthTag().toString('hex'), keyVersion: 1 }], skipDuplicates: true });
      row = await db.managedAgentWallet.findUnique({ where: { userId: actor.userId } });
    }
    if (!row || row.agentId !== actor.agentId) throw new AppError('FORBIDDEN', '이 에이전트의 지갑에 접근할 수 없습니다.', 403);
    return row;
  }
  function decrypt(row: WalletRow): Hex {
    try {
      if (row.keyVersion !== 1) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', master, Buffer.from(row.iv, 'hex'), { authTagLength: 16 }); decipher.setAAD(aad(row)); decipher.setAuthTag(Buffer.from(row.authTag, 'hex'));
      const key = Buffer.concat([decipher.update(Buffer.from(row.ciphertext, 'hex')), decipher.final()]);
      const keyHex = `0x${key.toString('hex')}` as Hex;
      const signer = privateKeyToAccount(keyHex); key.fill(0);
      if (signer.address.toLowerCase() !== row.address) throw new Error();
      return keyHex;
    } catch { throw unavailable(); }
  }
  async function account(userId: string, agentId?: string) {
    const row = await prisma.managedAgentWallet.findUnique({ where: { userId } });
    if (!row) return null;
    if (agentId && row.agentId !== agentId) throw new AppError('FORBIDDEN', '이 에이전트의 지갑에 접근할 수 없습니다.', 403);
    return privateKeyToAccount(decrypt(row));
  }
  async function addressFor(actor: Actor) { const row = await prisma.managedAgentWallet.findUnique({ where: { userId: actor.userId } }); return row?.agentId === actor.agentId ? row.address as Hex : null; }
  const sign: AgentPaymentSigner = async input => {
    if (!input.auth) throw new AppError('UNAUTHORIZED', '지갑 소유자 인증이 필요합니다.', 401);
    const row = await prisma.managedAgentWallet.findUnique({ where: { userId: input.auth.userId } });
    if (!row || row.agentId !== input.auth.agentId) throw unavailable();
    const key = decrypt(row), signer = privateKeyToAccount(key);
    const wallet = signerFactory({ ...env, AGENT_WALLET_ADDRESS: signer.address, AGENT_SERVER_WALLET_ADDRESS: signer.address }, { AGENT_SERVER_PRIVATE_KEY: key });
    if (!wallet) throw unavailable();
    return wallet.sign(input);
  };
  return { ensure, account, addressFor, sign,
    async userForAddress(address: string) { return (await prisma.managedAgentWallet.findUnique({ where: { address: address.toLowerCase() } }))?.userId ?? null; },
    async info(actor: Actor) {
      const row = await ensure(prisma, actor);
      let balance: string | null = null, balanceUpdatedAt: string | null = null;
      try { balance = (await balanceOf(row.address as Hex)).toString(); balanceUpdatedAt = new Date().toISOString(); } catch { /* Unknown balance is never displayed as zero. */ }
      return agentWalletInfoSchema.parse({ address: row.address, chainId: profile.chainId, network: env.PAYMENT_CHAIN === 'maroo' ? 'Maroo Testnet' : 'Base Sepolia', currency: profile.currency, decimals: profile.decimals, balance, balanceUpdatedAt, createdAt: row.createdAt.toISOString() });
    },
  };
}
export type ManagedAgentWallets = ReturnType<typeof createManagedAgentWallets>;
export function createManagedAgentWalletPlugin(wallets: ManagedAgentWallets, requireAuth: (request: import('fastify').FastifyRequest) => AuthContext): FastifyPluginAsync {
  return async app => { app.get('/api/agent/wallet', async request => { const auth = requireAuth(request); if (!auth.walletAddress || !auth.agentId) throw new AppError('UNAUTHORIZED', '지갑 로그인이 필요합니다.', 401); return wallets.info({ userId: auth.userId, agentId: auth.agentId }); }); };
}
