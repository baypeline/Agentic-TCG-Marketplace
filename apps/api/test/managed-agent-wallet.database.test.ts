import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { generatePrivateKey } from 'viem/accounts';
import Fastify from 'fastify';
import { createWalletAuth } from '../src/wallet-auth.js';
import { createPrismaClient } from '@tcg/db';
import { parseApiEnv } from '@tcg/config';
import { inspectNativePayment } from '@tcg/payment-client/native';
import { createManagedAgentWallets } from '../src/managed-agent-wallet.js';
import { createAgentWallet } from '../src/agent-wallet.js';
import { demoBuyerId, demoBuyerAgentId } from '../src/demo-auth.js';

const env = parseApiEnv({ NODE_ENV: 'test', PAYMENT_CHAIN: 'maroo', PAYMENT_FACILITATOR_URL: 'http://127.0.0.1:4022', AGENT_SIGNING_MODE: 'server', AGENT_SERVER_WALLET_ADDRESS: `0x${'2'.repeat(40)}`, DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/unused', CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', DEMO_SCENARIOS_ENABLED: 'true', PAYMENT_ENABLED: 'true', AGENT_WALLET_ADDRESS: `0x${'2'.repeat(40)}`, PAYMENT_RECIPIENT: `0x${'1'.repeat(40)}`, DEMO_BUYER_TOKEN: 'b'.repeat(32), DEMO_SELLER_TOKEN: 's'.repeat(32) });
const actor = () => ({ userId: randomUUID(), agentId: randomUUID() });
it.skipIf(!process.env.DATABASE_TEST_URL)('첫 로그인 트랜잭션이 전용 지갑을 발급하고 재로그인에서도 같은 주소를 반환한다', async () => {
  const db=createPrismaClient(process.env.DATABASE_TEST_URL!),login=privateKeyToAccount(generatePrivateKey()),origin='http://127.0.0.1:3000',binding='e'.repeat(64);
  const service=createManagedAgentWallets({prisma:db,env,encryptionKey:randomBytes(32).toString('hex')});
  const app=Fastify(); let userId:string|undefined;
  try {
    await app.register(createWalletAuth({prisma:db,origin,chainId:450815,provisionAgentWallet:service.ensure}).plugin);
    async function signIn(){const challenge=(await app.inject({method:'POST',url:'/api/auth/challenge',headers:{origin},payload:{address:login.address,binding}})).json();const response=await app.inject({method:'POST',url:'/api/auth/verify',headers:{origin},payload:{challengeId:challenge.id,binding,signature:await login.signMessage({message:challenge.message})}});expect(response.statusCode).toBe(200);return response.json();}
    const first=await signIn();userId=first.user.userId;
    expect(first.user.agentWalletLinked).toBe(true);expect(first.user.agentWalletAddress.toLowerCase()).not.toBe(login.address.toLowerCase());
    const row=await db.managedAgentWallet.findUniqueOrThrow({where:{userId}});
    expect(row.address).toBe(first.user.agentWalletAddress.toLowerCase());
    const second=await signIn();expect(second.user.agentWalletAddress).toBe(first.user.agentWalletAddress);
    expect(await db.managedAgentWallet.findUnique({where:{userId}})).toEqual(row);
    expect(JSON.stringify(second)).not.toContain(row.ciphertext);
  }finally{await app.close();if(userId)await db.managedAgentWallet.deleteMany({where:{userId}});await db.walletSession.deleteMany({where:{address:login.address.toLowerCase()}});await db.walletChallenge.deleteMany({where:{address:login.address.toLowerCase()}});await db.walletIdentity.deleteMany({where:{address:login.address.toLowerCase()}});await db.$disconnect();}
});
it.skipIf(!process.env.DATABASE_TEST_URL)('기존 데모 지갑 키는 같은 주소로 보존하고 이후 초기화로 교체하지 않는다', async () => {
  const db=createPrismaClient(process.env.DATABASE_TEST_URL!),legacyKey=generatePrivateKey(),encryptionKey=randomBytes(32).toString('hex'),owner={userId:demoBuyerId,agentId:demoBuyerAgentId};
  const before=await db.managedAgentWallet.findUnique({where:{userId:demoBuyerId}});
  try {
    const service=createManagedAgentWallets({prisma:db,env,encryptionKey,legacyKey});
    const row=await service.ensure(db,owner);
    expect(row.address).toBe(before?.address??privateKeyToAccount(legacyKey).address.toLowerCase());
    if(!before)expect(row.ciphertext).not.toBe(legacyKey.slice(2));
    const restarted=createManagedAgentWallets({prisma:db,env,encryptionKey,legacyKey:generatePrivateKey()});
    expect((await restarted.ensure(db,owner)).address).toBe(row.address);
  }finally{if(!before)await db.managedAgentWallet.deleteMany({where:{userId:demoBuyerId}});await db.$disconnect();}
});
it.skipIf(!process.env.DATABASE_TEST_URL)('지갑은 동시 요청·재시작에도 동일하며 다른 사용자·Agent와 분리되고 암호문만 저장한다', async () => {
  const db = createPrismaClient(process.env.DATABASE_TEST_URL!), a = actor(), b = actor(), encryptionKey = randomBytes(32).toString('hex');
  const service = createManagedAgentWallets({ prisma: db, env, encryptionKey, readBalance: async () => 0n });
  try {
    const rows = await Promise.all(Array.from({ length: 6 }, () => service.ensure(db, { ...a, lastLoginAt: new Date() } as typeof a)));
    expect(new Set(rows.map(row=>row.address)).size).toBe(1);
    const other = await service.ensure(db,b); expect(other.address).not.toBe(rows[0]!.address);
    expect(await db.managedAgentWallet.count({ where: { userId: a.userId } })).toBe(1);
    expect((await createManagedAgentWallets({prisma:db,env,encryptionKey}).ensure(db,a)).address).toBe(rows[0]!.address);
    expect(await service.addressFor({userId:a.userId,agentId:b.agentId})).toBeNull();
    await expect(service.account(a.userId,b.agentId)).rejects.toMatchObject({code:'FORBIDDEN'});
    const row=rows[0]!, info=await service.info(a), signer=await service.account(a.userId,a.agentId);
    expect(info.balance).toBe('0'); expect(signer!.address.toLowerCase()).toBe(info.address);
    expect(Object.keys(info)).not.toEqual(expect.arrayContaining(['ciphertext','authTag','iv']));
    expect(row.ciphertext).toHaveLength(64); expect(row.iv).toHaveLength(24); expect(row.authTag).toHaveLength(32);
    await expect(createManagedAgentWallets({prisma:db,env,encryptionKey:randomBytes(32).toString('hex')}).account(a.userId,a.agentId)).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'});
    await db.managedAgentWallet.update({where:{userId:a.userId},data:{ciphertext:other.ciphertext,iv:other.iv,authTag:other.authTag}});
    await expect(service.account(a.userId,a.agentId)).rejects.toMatchObject({code:'PAYMENT_UNAVAILABLE'});
  } finally { await db.managedAgentWallet.deleteMany({where:{userId:{in:[a.userId,b.userId]}}}); await db.$disconnect(); }
});
it.skipIf(!process.env.DATABASE_TEST_URL)('보관 지갑으로 x402 서명하고 잘못된 Agent는 거부하며 잔액 조회 실패는 null로 구분한다', async () => {
  const db=createPrismaClient(process.env.DATABASE_TEST_URL!),a=actor(),encryptionKey=randomBytes(32).toString('hex');
  const service=createManagedAgentWallets({prisma:db,env,encryptionKey,readBalance:async()=>{throw new Error('RPC unavailable');},signerFactory:(config,variables)=>createAgentWallet(config,variables,{readBalance:async()=>100n*10n**18n,prepareNative:async()=>({nonce:0,gas:30000n,gasPrice:1n})})});
  try {
    const row=await service.ensure(db,a), id=randomUUID();
    const requirements={scheme:'maroo-native' as const,network:'eip155:450815' as const,asset:'native:tOKRW' as const,amount:'3000000000000000000',payTo:env.PAYMENT_RECIPIENT!,maxTimeoutSeconds:60,extra:{name:'tOKRW',version:'1',tcgQuoteId:id,expiresAt:new Date(Date.now()+60000).toISOString()}};
    const input={requirements,amount:requirements.amount,matchQuoteId:id,auth:a};
    const signed=await service.sign(input);
    expect((await inspectNativePayment(signed as Parameters<typeof inspectNativePayment>[0],requirements)).payer.toLowerCase()).toBe(row.address);
    await expect(service.sign({...input,auth:{...a,agentId:randomUUID()}})).rejects.toThrow();
    expect((await service.info(a)).balance).toBeNull();
  } finally {await db.managedAgentWallet.deleteMany({where:{userId:a.userId}});await db.$disconnect();}
});
