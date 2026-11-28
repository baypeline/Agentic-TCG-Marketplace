import { expect, it } from 'vitest';
import { withWalletLock } from '../src/index.js';
it('동일 지갑의 작업은 실패 후에도 직렬화하고 다른 지갑은 진행한다',async()=>{
 const order:string[]=[];let release!:()=>void;const hold=new Promise<void>(r=>{release=r;});
 const first=withWalletLock('0xA',async()=>{order.push('first');await hold;order.push('released');throw new Error('RPC timeout');});
 const second=withWalletLock('0xa',async()=>{order.push('second');return 2;});
 const other=withWalletLock('0xB',async()=>{order.push('other');});
 await other;expect(order).toEqual(['first','other']);release();await expect(first).rejects.toThrow('RPC timeout');expect(await second).toBe(2);expect(order).toEqual(['first','other','released','second']);
});
