import { createPublicClient, http, encodeFunctionData, decodeEventLog, keccak256, toBytes, type Hex, type PrivateKeyAccount } from 'viem';
import type { PaymentRequirements } from '@x402/core/types';
import { privateKeyToAccount } from 'viem/accounts';
import { AppError } from '@tcg/contracts';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '@tcg/db';
import { marooTestnet } from '@tcg/payment-client/native';
import { cardMarketplaceAbi, cardVaultAbi, quoteDomain, quoteMessage, quoteTypes, type RwaDeployment, type RwaQuote } from '@tcg/payment-client/rwa';

const locks = new Map<string, Promise<unknown>>();
export function withWalletLock<T>(address: string, work: () => Promise<T>): Promise<T> {
  const key = address.toLowerCase(), task = (locks.get(key) ?? Promise.resolve()).then(work);
  locks.set(key, task.catch(() => undefined)); return task;
}
function rowId(key: string) { const h = createHash('sha256').update(key).digest('hex'); return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-8${h.slice(17,20)}-${h.slice(20,32)}`; }
const deny = () => new AppError('FORBIDDEN', '이 NFT를 처리할 지갑 권한이 없습니다.', 403);
export function createRwaService({ prisma, deployment, deployBlock, buyerKey, operatorKey, buyerUserId, sellerUserId, rpcUrl, releaseQuote }: {
  prisma: PrismaClient; deployment: RwaDeployment; deployBlock: bigint; buyerKey: Hex; operatorKey: Hex; buyerUserId: string; sellerUserId: string; rpcUrl?: string; releaseQuote?: (userId:string,agentId:string,quoteId:string)=>Promise<unknown>;
}) {
  const buyer = privateKeyToAccount(buyerKey), operator = privateKeyToAccount(operatorKey);
  if (operator.address.toLowerCase() !== deployment.quoteSigner.toLowerCase() || buyer.address === operator.address) throw new Error('RWA wallet configuration mismatch');
  const chain = createPublicClient({ chain: marooTestnet, transport: http(rpcUrl, { timeout: 15_000, retryCount: 1 }) });
  const wallet = (userId: string) => userId === buyerUserId ? buyer : userId === sellerUserId ? operator : null;
  const userFor = (address: string) => address.toLowerCase() === buyer.address.toLowerCase() ? buyerUserId : address.toLowerCase() === operator.address.toLowerCase() ? sellerUserId : '00000000-0000-4000-8000-000000000000';
  let syncing: Promise<void> | undefined;
  const cursorId = `${450815}:${deployment.market}`;
  async function syncWork() {
    if (await chain.getChainId() !== 450815) throw new Error('RWA chain mismatch');
    const [marketCode, nftCode] = await Promise.all([chain.getCode({ address: deployment.market }), chain.getCode({ address: deployment.nft })]);
    if (!marketCode || !nftCode || keccak256(marketCode) !== deployment.marketCodeHash || keccak256(nftCode) !== deployment.nftCodeHash) throw new Error('RWA deployment code mismatch');
    const cursor = await prisma.rwaChainCursor.findUnique({ where: { id: cursorId } });
    if (cursor) {
      const block = await chain.getBlock({ blockNumber: cursor.blockNumber });
      if (block.hash !== cursor.blockHash) throw new Error('RWA block hash mismatch; manual projection rebuild required');
    }
    const finalized = await chain.getBlock({blockTag:'finalized'});
    if(finalized.number===null)throw new Error('Finalized block unavailable');
    const head = finalized.number;
    let from = cursor ? cursor.blockNumber + 1n : deployBlock;
    while (from <= head) {
      const to = from + 499n < head ? from + 499n : head;
      const logs = await chain.getLogs({ address: [deployment.nft, deployment.market], fromBlock: from, toBlock: to });
      for (const log of logs) {
        if (log.blockNumber === null || !log.blockHash || !log.transactionHash || log.logIndex === null) continue;
        let event: { eventName: string; args: Record<string, unknown> };
        try { event = decodeEventLog({ abi: log.address.toLowerCase() === deployment.nft ? cardVaultAbi : cardMarketplaceAbi, data: log.data, topics: log.topics }) as typeof event; } catch { continue; }
        const id = `${450815}:${log.transactionHash}:${log.logIndex}`;
        await prisma.$transaction(async tx => {
          if (await tx.rwaChainEvent.findUnique({ where: { id } })) return;
          const a = event.args, tokenId = a.tokenId?.toString();
          const asset = tokenId ? await tx.rwaAsset.findUnique({ where: { chainId_nftAddress_tokenId: { chainId: 450815, nftAddress: deployment.nft, tokenId } } }) : null;
          const payloadJson = JSON.stringify(a, (_, v) => typeof v === 'bigint' ? v.toString() : v);
          // Mint/escrow logs preceding registration are replayed after seeding; a cursor is not advanced by the seed script.
          if (asset && event.eventName === 'Transfer') {
            const toWallet = String(a.to).toLowerCase();
            if (toWallet !== deployment.market && toWallet !== deployment.nft && toWallet !== '0x0000000000000000000000000000000000000000') {
              await tx.rwaAsset.update({ where: { id: asset.id }, data: { ownerWallet: toWallet, state: 'ACTIVE' } });
              const inFlight = await tx.matchQuote.count({ where: { inventoryItemId: asset.inventoryItemId, status: { in: ['PAYMENT_PENDING','RECONCILING','SETTLED'] } } });
              if (!inFlight) await tx.inventoryItem.update({ where: { id: asset.inventoryItemId }, data: { ownerId: userFor(toWallet), status: 'AVAILABLE' } });
            }
          }
          if (asset && event.eventName === 'ListingCreated') {
            const listingId = rowId(`${deployment.market}:${a.listingId}`), sellerWallet = String(a.seller).toLowerCase();
            await tx.inventoryItem.update({ where: { id: asset.inventoryItemId }, data: { ownerId: userFor(sellerWallet), status: 'LISTED' } });
            await tx.listing.upsert({ where: { id: listingId }, create: { id: listingId, inventoryItemId: asset.inventoryItemId, cardVariantId: asset.cardVariantId, sellerId: userFor(sellerWallet), price: String(a.price), status: 'ACTIVE', createdAt: new Date() }, update: {} });
            await tx.rwaListing.upsert({ where: { id: listingId }, create: { id: listingId, assetId: asset.id, chainListingId: String(a.listingId), marketAddress: deployment.market, sellerWallet, price: String(a.price), txHash: log.transactionHash! }, update: {} });
            await tx.rwaAsset.update({ where: { id: asset.id }, data: { state: 'LISTED', ownerWallet: sellerWallet } });
          }
          if (asset && event.eventName === 'ListingCancelled') {
            const listingId = rowId(`${deployment.market}:${a.listingId}`);
            await tx.listing.updateMany({ where: { id: listingId, status: 'ACTIVE' }, data: { status: 'CANCELLED' } });
          }
          if (asset && event.eventName === 'RedemptionChanged') {
            const state = ['UNKNOWN','REQUESTED','RELEASE_APPROVED','REDEEMED','CANCELLED'][Number(a.status)]!;
            await tx.rwaRedemption.upsert({ where: { id: String(a.requestId) }, create: { id: String(a.requestId), assetId: asset.id, claimant: String(a.claimant).toLowerCase(), status: state, txHash: log.transactionHash! }, update: { status: state, txHash: log.transactionHash! } });
            await tx.rwaAsset.update({ where: { id: asset.id }, data: { state: state === 'CANCELLED' ? 'ACTIVE' : state, ownerWallet: String(a.claimant).toLowerCase() } });
          }
          if(event.eventName==='PurchaseExecuted') {
            // Recover the existing payment when the facilitator's HTTP response was lost.
            // Full receipt/quote verification remains the Payment adapter's responsibility.
            const candidates=await tx.paymentAttempt.findMany({where:{status:{in:['PENDING','UNKNOWN']},requirementsJson:{contains:String(a.quoteId)}}});
            for(const attempt of candidates){
              const requirements=JSON.parse(attempt.requirementsJson);
              if(requirements.scheme!=='maroo-rwa'||requirements.payTo.toLowerCase()!==deployment.market||requirements.extra?.rwa?.quote?.quoteId!==a.quoteId)continue;
              if(!attempt.transactionHash)await tx.paymentAttempt.update({where:{id:attempt.id},data:{transactionHash:log.transactionHash!,updatedAt:new Date()}});
            }
          }
          await tx.rwaChainEvent.create({ data: { id, blockNumber: log.blockNumber!, blockHash: log.blockHash!, txHash: log.transactionHash!, logIndex: log.logIndex!, name: event.eventName, payloadJson } });
        });
      }
      const block = await chain.getBlock({ blockNumber: to });
      await prisma.rwaChainCursor.upsert({ where: { id: cursorId }, create: { id: cursorId, blockNumber: to, blockHash: block.hash! }, update: { blockNumber: to, blockHash: block.hash! } });
      from = to+1n;
    }
    // Reconcile terminal on-chain listings after delayed Payment/Trading recovery.
    const mappings=await prisma.rwaListing.findMany({include:{asset:true}});
    for(const mapping of mappings){
      const row=await prisma.listing.findUnique({where:{id:mapping.id}});if(!row||!['ACTIVE','RESERVED'].includes(row.status))continue;
      const live=await chain.readContract({address:deployment.market,abi:cardMarketplaceAbi,functionName:'listings',args:[BigInt(mapping.chainListingId)]});
      if(live[4]===3){
        const quotes=await prisma.matchQuote.findMany({where:{listingId:mapping.id,status:{in:['RESERVED','PAYMENT_PENDING','RECONCILING','SETTLED']}}});
        if(quotes.some(q=>q.status!=='RESERVED'))continue;
        for(const quote of quotes){if(!releaseQuote)throw new Error('Quote release unavailable');await releaseQuote(quote.buyerId,quote.buyerAgentId,quote.id);}
        await prisma.$transaction(async tx=>{await tx.listing.update({where:{id:mapping.id},data:{status:'CANCELLED'}});await tx.inventoryItem.update({where:{id:mapping.asset.inventoryItemId},data:{status:'AVAILABLE',ownerId:userFor(mapping.sellerWallet)}});});
      }
    }
  }
  async function sync() { if (!syncing) syncing = syncWork().finally(() => { syncing = undefined; }); return syncing; }
  async function completeAction(id: string) {
    const row = await prisma.rwaAction.findUniqueOrThrow({ where: { id } });
    if (row.status !== 'PENDING' || !row.txHash) return row;
    try {
      const receipt = await chain.getTransactionReceipt({ hash: row.txHash as Hex });
      await prisma.rwaAction.update({ where: { id }, data: { status: receipt.status === 'success' ? 'COMPLETED' : 'FAILED' } });
      await sync(); return await prisma.rwaAction.findUniqueOrThrow({ where: { id } });
    } catch { return row; }
  }
  async function action(userId: string, requestId: string, kind: string, input: Record<string, unknown>) {
    const account = wallet(userId); if (!account) throw deny();
    return withWalletLock(account.address, async () => {
      const inputHash = keccak256(toBytes(JSON.stringify({ kind, input })));
      const previous = await prisma.rwaAction.findUnique({ where: { id: requestId } });
      if (previous) { if (previous.userId !== userId || previous.inputHash !== inputHash) throw new AppError('IDEMPOTENCY_CONFLICT', '요청 키가 다른 작업에 사용됐습니다.',409); return completeAction(requestId); }
      // Persist a claim before signing. A hash-less claim is never automatically resubmitted.
      await prisma.rwaAction.create({ data: { id: requestId, userId, inputHash, status: 'PREPARING' } });
      let to = deployment.nft, data: Hex;
      try {
        if (kind === 'withdraw') { to = deployment.market; data = encodeFunctionData({ abi: cardMarketplaceAbi, functionName: 'withdrawProceeds', args: [account.address] }); }
        else {
          const asset = await prisma.rwaAsset.findUniqueOrThrow({ where: { id: String(input.assetId) } });
          const owner = await chain.readContract({ address: deployment.nft, abi: cardVaultAbi, functionName: 'ownerOf', args: [BigInt(asset.tokenId)] });
          if (kind === 'cancel-listing') {
            const listing = await prisma.rwaListing.findUniqueOrThrow({ where: { id: String(input.listingId) } });
            if (listing.assetId !== asset.id || listing.sellerWallet !== account.address.toLowerCase()) throw deny();
            const held=await prisma.matchQuote.findMany({where:{listingId:listing.id,status:{in:['RESERVED','PAYMENT_PENDING','RECONCILING','SETTLED']}}});
            if(held.some(q=>q.status!=='RESERVED'))throw new Error('Payment must be reconciled before cancellation');
            for(const quote of held){if(!releaseQuote)throw new Error('Quote release unavailable');await releaseQuote(quote.buyerId,quote.buyerAgentId,quote.id);}
            to = deployment.market; data = encodeFunctionData({ abi: cardMarketplaceAbi, functionName: 'cancelListing', args: [BigInt(listing.chainListingId)] });
          } else if (kind === 'approve-nft' || kind === 'list' || kind === 'redeem') {
            if (owner.toLowerCase() !== account.address.toLowerCase()) throw deny();
            if (kind === 'approve-nft') data = encodeFunctionData({ abi: cardVaultAbi, functionName: 'approve', args: [deployment.market, BigInt(asset.tokenId)] });
            else if (kind === 'list') { to = deployment.market; data = encodeFunctionData({ abi: cardMarketplaceAbi, functionName: 'createListing', args: [BigInt(asset.tokenId), BigInt(String(input.price)), BigInt(Math.floor(Date.now()/1000)+86400)] }); }
            else data = encodeFunctionData({ abi: cardVaultAbi, functionName: 'requestRedemption', args: [BigInt(asset.tokenId), keccak256(toBytes(requestId))] });
          } else {
            const redemption = await prisma.rwaRedemption.findUniqueOrThrow({ where: { id: String(input.redemptionId) } });
            if (redemption.assetId !== asset.id) throw deny();
            if (kind === 'cancel-redemption') { if (redemption.claimant !== account.address.toLowerCase()) throw deny(); data = encodeFunctionData({ abi: cardVaultAbi, functionName: 'cancelRedemption', args: [redemption.id as Hex] }); }
            else { if (userId !== sellerUserId) throw deny(); const fn = kind === 'approve-release' ? 'approveRelease' : kind === 'abort-release' ? 'abortRelease' : kind === 'finalize-redemption' ? 'finalizeRedemption' : null; if (!fn) throw deny(); data = encodeFunctionData({ abi: cardVaultAbi, functionName: fn, args: [redemption.id as Hex] }); }
          }
        }
        const [nonce, gas, gasPrice, balance] = await Promise.all([chain.getTransactionCount({ address: account.address, blockTag:'pending' }), chain.estimateGas({ account:account.address, to, data }), chain.getGasPrice(), chain.getBalance({ address:account.address })]);
        if (gas>1_000_000n || gas*gasPrice>10n*10n**18n || balance<gas*gasPrice) throw new Error('Action gas/balance limit');
        const raw = await account.signTransaction({ chainId:450815, type:'legacy', to, data, nonce, gas, gasPrice });
        const hash = keccak256(raw);
        await prisma.rwaAction.update({ where:{id:requestId}, data:{status:'PENDING',txHash:hash} });
        const sent = await chain.sendRawTransaction({ serializedTransaction:raw });
        if (sent !== hash) throw new Error('Hash mismatch');
        await chain.waitForTransactionReceipt({ hash,timeout:40_000 });
        return completeAction(requestId);
      } catch {
        const row=await prisma.rwaAction.findUniqueOrThrow({where:{id:requestId}});
        if (!row.txHash) await prisma.rwaAction.update({where:{id:requestId},data:{status:'FAILED'}});
        return await prisma.rwaAction.findUniqueOrThrow({where:{id:requestId}});
      }
    });
  }
  return {
    sync, action, deployment,
    async status(userId:string,id:string) { const row=await prisma.rwaAction.findUnique({where:{id}}); if(!row||row.userId!==userId)throw deny(); return completeAction(id); },
    async view(userId:string) {
      await sync(); const account=wallet(userId); if(!account)throw deny();
      const assets=await prisma.rwaAsset.findMany({include:{listings:true,redemptions:true}});
      const cards=await prisma.cardVariant.findMany({where:{id:{in:assets.map(a=>a.cardVariantId)}},include:{localizedNames:true}});
      const listings=await prisma.listing.findMany({where:{id:{in:assets.flatMap(a=>a.listings.map(l=>l.id))}}});
      return { deployment, custodyMode:'DEMO', wallet:account.address, role:userId===sellerUserId?'custodian':'buyer', currency:'tOKRW', proceeds:(await chain.readContract({address:deployment.market,abi:cardMarketplaceAbi,functionName:'proceeds',args:[account.address]})).toString(), assets:assets.map(a=>({...a,listings:a.listings.map(l=>({...l,status:listings.find(x=>x.id===l.id)?.status??'UNKNOWN'}))})), cards };
    },
    async requirements(quote: { id:string; inventoryItemId:string; listingId:string; amount:string; expiresAt:Date }, auth:{userId:string}, policy:{id:string;version:number}):Promise<PaymentRequirements|null> {
      const mapping=await prisma.rwaListing.findUnique({where:{id:quote.listingId},include:{asset:true}}); if(!mapping)return null;
      const live=await chain.readContract({address:deployment.market,abi:cardMarketplaceAbi,functionName:'listings',args:[BigInt(mapping.chainListingId)]});
      if(live[4]!==1||live[2]!==BigInt(quote.amount))throw new AppError('LISTING_UNAVAILABLE','온체인 매물 상태나 가격이 변경됐습니다.',409);
      const account=wallet(auth.userId); if(!account)throw deny();
      const q:RwaQuote={quoteId:keccak256(toBytes(quote.id)),listingId:mapping.chainListingId,nft:deployment.nft,tokenId:mapping.asset.tokenId,buyer:account.address.toLowerCase() as Hex,recipient:account.address.toLowerCase() as Hex,seller:mapping.sellerWallet as Hex,amount:quote.amount,deadline:String(Math.floor(quote.expiresAt.getTime()/1000)),policyHash:keccak256(toBytes(`${policy.id}:${policy.version}`))};
      const signature=await operator.signTypedData({domain:quoteDomain(deployment.market),types:quoteTypes,primaryType:'Quote',message:quoteMessage(q)});
      const data=encodeFunctionData({abi:cardMarketplaceAbi,functionName:'buyListing',args:[quoteMessage(q),signature]});
      return {scheme:'maroo-rwa',network:'eip155:450815',asset:'native:tOKRW',amount:quote.amount,payTo:deployment.market,maxTimeoutSeconds:60,extra:{name:'tOKRW',version:'1',tcgQuoteId:quote.id,expiresAt:quote.expiresAt.toISOString(),rwa:{quote:q,signature,calldataHash:keccak256(data)}}};
    },
  };
}
export type RwaService = ReturnType<typeof createRwaService>;
