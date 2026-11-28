import { getPaymentProfile } from '@tcg/contracts/payment-profile';
import { createRwaService, withWalletLock } from '@tcg/rwa';
import { readRwaDeployment } from '@tcg/payment-client/rwa';
import { z } from 'zod';
import { demoBuyerId } from './demo-auth.js';
import { createRwaPlugin } from './rwa.js';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '@tcg/contracts';
import { createMcpPlugin } from '@tcg/mcp-server';
import { createServerRunPlugin, type AgentSessionPluginOptions } from '@tcg/agent';
import { createDemoPurchaseHandler } from './demo-purchase.js';
import type { AgentPaymentSigner } from './agent-wallet.js';
import { createCommercePlugin, createPaymentEvidenceReader, createPaymentService, createPolicyService, getPolicyExecutionContext } from '@tcg/payment-server';
import { createMockTradingStore, createPrismaTradingStore, createTradingPlugin, createTradingService, demoSellerId, type TradingService } from '@tcg/trading';
import { requireAuth, type IntegrationDependencies } from './app.js';

export async function createIntegrationPlugins({ env, prisma, aggregatorService, valuationService, tradingExecutionContext, paymentOptions, executeAgentRun }: IntegrationDependencies, options: { signAgentPayment?: AgentPaymentSigner; rwaVariables?: NodeJS.ProcessEnv; onDemoPurchaseReady?: (handler: NonNullable<AgentSessionPluginOptions['purchase']>) => void } = {}): Promise<FastifyPluginAsync[]> {
  const store = env.TRADING_DATA_SOURCE === 'database' ? createPrismaTradingStore(prisma!) : createMockTradingStore();
  const profile = getPaymentProfile(env.PAYMENT_CHAIN);
  const deployment = env.RWA_ENABLED ? readRwaDeployment(env) : null;
  let trading: TradingService;
  const rwa = deployment ? createRwaService({ prisma: prisma!, deployment, deployBlock: env.RWA_DEPLOY_BLOCK!, buyerKey: z.string().regex(/^0x[\da-fA-F]{64}$/).parse(options.rwaVariables?.AGENT_SERVER_PRIVATE_KEY) as `0x${string}`, operatorKey: z.string().regex(/^0x[\da-fA-F]{64}$/).parse(options.rwaVariables?.RWA_OPERATOR_PRIVATE_KEY) as `0x${string}`, buyerUserId: demoBuyerId, sellerUserId: demoSellerId, releaseQuote:(userId,agentId,id)=>trading.releaseQuote({userId,agentId},id) }) : null;
  const policies = createPolicyService({ store, onInactive: auth => trading.pauseAgentOrders(auth) });
  trading = createTradingService({ store, currency: profile.currency, payment: createPaymentEvidenceReader(store, profile.currency), valuationService,
    ...(prisma ? {
      assertInventoryMutation: async (inventoryItemId: string) => { if (await prisma.rwaAsset.findUnique({ where: { inventoryItemId } })) throw new AppError('POLICY_VIOLATION', 'NFT는 RWA 화면에서 온체인으로 등록·취소해 주세요.',409); },
      decorateListing: async (listing: import('@tcg/contracts').Listing) => { const mapping=await prisma.rwaListing.findUnique({where:{id:listing.id},include:{asset:true}}); return mapping ? {...listing,rwa:{assetId:mapping.assetId,nft:mapping.asset.nftAddress,tokenId:mapping.asset.tokenId,custodyMode:'DEMO' as const}} : listing; },
    } : {}),
    executionContext: tradingExecutionContext,
    // Tests/custom hosts may inject a trusted reader. Production uses the shared transaction.
    executionInTransaction: tradingExecutionContext ? undefined : getPolicyExecutionContext,
  });
  const payments = createPaymentService({ ...paymentOptions, paymentChain: env.PAYMENT_CHAIN, store, tradingService: trading, valuationService,
    createRequirements: async (quote, auth, policy) => { if(rwa)return rwa.requirements(quote,auth,policy); if(prisma && await prisma.rwaListing.findUnique({where:{id:quote.listingId}}))throw new AppError('PAYMENT_UNAVAILABLE','RWA 결제가 비활성 상태입니다.',409); return null; },
  });
  const plugin: FastifyPluginAsync = async app => {
    if (rwa) { await rwa.sync(); await app.register(createRwaPlugin(rwa)); }
    if (env.DEMO_SCENARIOS_ENABLED) {
      const handler=createDemoPurchaseHandler({ env, trading, policies, includeKorean:true,signAgentPayment: options.signAgentPayment, resolvePaymentRecipient: async listingId => prisma && await prisma.rwaListing.findUnique({where:{id:listingId}}) ? deployment?.market ?? '' : env.PAYMENT_RECIPIENT!, getMcpUrl: () => {
      const address = app.server.address();
      if (!address || typeof address === 'string') throw new AppError('PAYMENT_UNAVAILABLE', 'MCP 서버가 수신 중이 아닙니다.', 503);
      return `http://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}/mcp`;
      } });
      options.onDemoPurchaseReady?.(input => rwa && input.action==='submit' ? withWalletLock(env.AGENT_WALLET_ADDRESS!,()=>handler(input)) : handler(input));
    }
    app.get('/api/me', async request => { const { userId, agentId } = requireAuth(request); return { userId, ...(agentId ? { agentId } : {}) }; });
    await app.register(createTradingPlugin({ tradingService: trading, requireAuth }), { prefix: '/api' });
    await app.register(createCommercePlugin({ policies, payments, requireAuth }), { prefix: '/api' });
    await app.register(createServerRunPlugin({ runs: policies, requireAuth, execute: executeAgentRun }));
    let running: Promise<unknown> | undefined;
    const sweep = async () => { await policies.expireRuns(); await trading.expireReservations(); await payments.recover(); await rwa?.sync(); };
    const timer = setInterval(() => { if (!running) running = sweep().catch(error => app.log.error({ err: error }, 'Marketplace recovery failed')).finally(() => { running = undefined; }); }, env.TRADING_SWEEP_INTERVAL_MS);
    timer.unref();
    app.addHook('onClose', async () => { clearInterval(timer); await running; });
  };
  return [plugin, createMcpPlugin({ aggregatorService, valuationService, tradingService: trading, paymentService: payments, getAuth: request => request.auth })];
}
