import { expect,it,vi } from 'vitest';
import { encodeAbiParameters,encodeEventTopics,keccak256,type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PrismaClient } from '@tcg/db';
import { cardMarketplaceAbi } from '@tcg/payment-client/rwa';
const rpc=vi.hoisted(()=>({getChainId:vi.fn(),getCode:vi.fn(),getBlockNumber:vi.fn(),getLogs:vi.fn(),getBlock:vi.fn()}));
vi.mock('viem',async actual=>({...await actual<typeof import('viem')>(),createPublicClient:()=>rpc}));
import { createRwaService } from '../src/service.js';
it('HTTP 응답이 유실된 기존 결제에 체인 이벤트의 해시를 연결하고 지급은 만들지 않는다',async()=>{
 const market=`0x${'33'.repeat(20)}` as Hex,nft=`0x${'44'.repeat(20)}` as Hex,quoteId=`0x${'55'.repeat(32)}` as Hex,txHash=`0x${'66'.repeat(32)}` as Hex,blockHash=`0x${'77'.repeat(32)}` as Hex;
 const opKey=`0x${'11'.repeat(32)}` as Hex,buyerKey=`0x${'22'.repeat(32)}` as Hex,operator=privateKeyToAccount(opKey),buyer=privateKeyToAccount(buyerKey);
 rpc.getChainId.mockResolvedValue(450815);rpc.getCode.mockResolvedValue('0x01');rpc.getBlockNumber.mockResolvedValue(7n);rpc.getBlock.mockResolvedValue({hash:blockHash,number:7n});
 rpc.getLogs.mockResolvedValue([{address:market,blockNumber:7n,blockHash,transactionHash:txHash,logIndex:0,topics:encodeEventTopics({abi:cardMarketplaceAbi,eventName:'PurchaseExecuted',args:{quoteId,listingId:1n,buyer:buyer.address}}),data:encodeAbiParameters([{type:'address'},{type:'address'},{type:'address'},{type:'uint256'},{type:'uint256'}],[buyer.address,operator.address,nft,1n,5n*10n**18n])}]);
 let saved=false;const update=vi.fn();const eventCreate=vi.fn(async()=>{saved=true;});
 const tx={rwaChainEvent:{findUnique:vi.fn(async()=>saved?{id:'existing'}:null),create:eventCreate},rwaAsset:{findUnique:vi.fn(async()=>null)},paymentAttempt:{findMany:vi.fn(async()=>[{id:'existing-payment',transactionHash:null,requirementsJson:JSON.stringify({scheme:'maroo-rwa',payTo:market,extra:{rwa:{quote:{quoteId}}}})}]),update}};
 const db={...tx,rwaListing:{findMany:vi.fn(async()=>[])},rwaChainCursor:{findUnique:vi.fn(async()=>null),upsert:vi.fn()},$transaction:vi.fn(async(fn:any)=>fn(tx))} as unknown as PrismaClient;
 const service=createRwaService({prisma:db,deployment:{market,nft,quoteSigner:operator.address,marketCodeHash:keccak256('0x01'),nftCodeHash:keccak256('0x01')},deployBlock:7n,buyerKey,operatorKey:opKey,buyerUserId:'buyer',sellerUserId:'seller'});
 await service.sync();await service.sync();expect(update).toHaveBeenCalledTimes(1);expect(update).toHaveBeenCalledWith({where:{id:'existing-payment'},data:{transactionHash:txHash,updatedAt:expect.any(Date)}});expect(eventCreate).toHaveBeenCalledTimes(1);
});
