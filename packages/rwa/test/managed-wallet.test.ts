import { expect,it,vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256,type Hex } from 'viem';
import type { PrismaClient } from '@tcg/db';
const rpc=vi.hoisted(()=>({readContract:vi.fn()}));
vi.mock('viem',async actual=>({...await actual<typeof import('viem')>(),createPublicClient:()=>rpc}));
import { createRwaService } from '../src/service.js';
it('새 사용자 NFT 구매의 지급 주체와 NFT 수신자는 해당 계정의 전용 지갑이다',async()=>{
 const operatorKey=`0x${'11'.repeat(32)}` as Hex,buyerKey=`0x${'22'.repeat(32)}` as Hex,managed=privateKeyToAccount(`0x${'55'.repeat(32)}`),operator=privateKeyToAccount(operatorKey),market=`0x${'33'.repeat(20)}` as Hex,nft=`0x${'44'.repeat(20)}` as Hex;
 const db={rwaListing:{findUnique:vi.fn(async()=>({chainListingId:'1',sellerWallet:operator.address.toLowerCase(),asset:{tokenId:'1'}}))}} as unknown as PrismaClient;
 rpc.readContract.mockResolvedValue([operator.address,1n,3n*10n**18n,0n,1]);
 const resolveWallet=vi.fn(async(userId:string)=>userId==='new-user'?managed:null);
 const service=createRwaService({prisma:db,deployment:{market,nft,quoteSigner:operator.address,marketCodeHash:keccak256('0x01'),nftCodeHash:keccak256('0x01')},deployBlock:1n,buyerKey,operatorKey,buyerUserId:'legacy',sellerUserId:'seller',resolveWallet});
 const requirements=await service.requirements({id:randomUUID(),inventoryItemId:randomUUID(),listingId:randomUUID(),amount:'3000000000000000000',expiresAt:new Date(Date.now()+60000)},{userId:'new-user'},{id:randomUUID(),version:1});
 expect(requirements).toMatchObject({scheme:'maroo-rwa',extra:{rwa:{quote:{buyer:managed.address.toLowerCase(),recipient:managed.address.toLowerCase()}}}});
 expect(resolveWallet).toHaveBeenCalledWith('new-user');
});
