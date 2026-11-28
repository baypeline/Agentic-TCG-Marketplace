import { expect,it,vi } from 'vitest';
import type { PrismaClient } from '@tcg/db';
import { createPrismaTradingStore } from '../src/store.js';
it('Prisma 드라이버의 원시 직렬화 충돌도 같은 업무를 재시도한다',async()=>{
 const conflict=Object.assign(new Error('TransactionWriteConflict'),{name:'DriverAdapterError',cause:{kind:'TransactionWriteConflict'}});
 const transaction=vi.fn().mockRejectedValueOnce(conflict).mockImplementation(async(work:any)=>work({}));
 const store=createPrismaTradingStore({$transaction:transaction} as unknown as PrismaClient);
 expect(await store.transaction(async()=>42)).toBe(42);expect(transaction).toHaveBeenCalledTimes(2);
});
it('드라이버의 다른 오류는 재시도로 숨기지 않는다',async()=>{
 const failure=Object.assign(new Error('Connection lost'),{name:'DriverAdapterError',cause:{kind:'ConnectionClosed'}});
 const transaction=vi.fn().mockRejectedValue(failure);const store=createPrismaTradingStore({$transaction:transaction} as unknown as PrismaClient);
 await expect(store.transaction(async()=>42)).rejects.toBe(failure);expect(transaction).toHaveBeenCalledTimes(1);
});
