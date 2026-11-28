import { beforeEach, expect, it, vi } from 'vitest';
import { keccak256, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import type { PrismaClient } from '@tcg/db';
const rpc=vi.hoisted(()=>({getTransactionCount:vi.fn(),estimateGas:vi.fn(),getGasPrice:vi.fn(),getBalance:vi.fn(),sendRawTransaction:vi.fn(),waitForTransactionReceipt:vi.fn(),getTransactionReceipt:vi.fn(),getChainId:vi.fn(),getCode:vi.fn(),getBlockNumber:vi.fn()}));
vi.mock('viem',async actual=>({...await actual<typeof import('viem')>(),createPublicClient:()=>rpc}));
import { createRwaService } from '../src/service.js';
beforeEach(()=>{vi.resetAllMocks();rpc.getTransactionCount.mockResolvedValue(0);rpc.estimateGas.mockResolvedValue(50000n);rpc.getGasPrice.mockResolvedValue(1n);rpc.getBalance.mockResolvedValue(100n*10n**18n);});
function fixture(){
 const rows=new Map<string,any>();
 const actions={findUnique:vi.fn(async({where}:any)=>rows.get(where.id)??null),findUniqueOrThrow:vi.fn(async({where}:any)=>{const r=rows.get(where.id);if(!r)throw new Error();return {...r};}),create:vi.fn(async({data}:any)=>{rows.set(data.id,{...data,txHash:null});return rows.get(data.id);}),update:vi.fn(async({where,data}:any)=>{const r={...rows.get(where.id),...data};rows.set(where.id,r);return r;})};
 const opKey=`0x${'11'.repeat(32)}` as Hex,buyerKey=`0x${'22'.repeat(32)}` as Hex;
 const db={rwaAction:actions} as unknown as PrismaClient;
 const service=createRwaService({prisma:db,deployment:{market:`0x${'33'.repeat(20)}`,nft:`0x${'44'.repeat(20)}`,quoteSigner:privateKeyToAccount(opKey).address,marketCodeHash:keccak256('0x01'),nftCodeHash:keccak256('0x01')},deployBlock:1n,buyerKey,operatorKey:opKey,buyerUserId:'buyer',sellerUserId:'seller'});
 return {service,rows,actions};
}
it('해시 기록 후 방송 응답이 유실되면 같은 작업을 다시 서명하거나 방송하지 않는다',async()=>{
 const f=fixture(),id='00000000-0000-4000-8000-000000000001';rpc.sendRawTransaction.mockRejectedValue(new Error('RPC response lost'));rpc.getTransactionReceipt.mockRejectedValue(new Error('Not found'));
 const result=await f.service.action('buyer',id,'withdraw',{});expect(result.status).toBe('PENDING');expect(result.txHash).toMatch(/^0x[\da-f]{64}$/);
 expect(await f.service.action('buyer',id,'withdraw',{})).toMatchObject({status:'PENDING',txHash:result.txHash});
 expect(rpc.getTransactionCount).toHaveBeenCalledTimes(1);expect(rpc.sendRawTransaction).toHaveBeenCalledTimes(1);
 const updateIndex=f.actions.update.mock.invocationCallOrder[0]!,broadcastIndex=rpc.sendRawTransaction.mock.invocationCallOrder[0]!;expect(updateIndex).toBeLessThan(broadcastIndex);
 await expect(f.service.action('seller',id,'withdraw',{})).rejects.toThrow();
 await expect(f.service.action('buyer',id,'redeem',{})).rejects.toThrow();
});
it('잔액·가스 검증 실패는 방송 없이 실패로 기록한다',async()=>{
 const f=fixture();rpc.getBalance.mockResolvedValue(0n);
 expect(await f.service.action('buyer','00000000-0000-4000-8000-000000000002','withdraw',{})).toMatchObject({status:'FAILED',txHash:null});expect(rpc.sendRawTransaction).not.toHaveBeenCalled();
});
