import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { parseApiEnv } from '@tcg/config';
import { buildApp } from '../src/app.js';
it.skipIf(!process.env.DATABASE_TEST_URL)('선별 검색은 불완전한 카드를 숨기고 limit 전에 한국어판을 우선하며 상세 조회는 보존한다',async()=>{
 const db=createPrismaClient(process.env.DATABASE_TEST_URL!);const query=`curated-${randomUUID()}`;
 const ids=[randomUUID(),randomUUID(),randomUUID()];let app:Awaited<ReturnType<typeof buildApp>>|undefined;
 try{
  for(const [i,id]of ids.entries())await db.cardVariant.create({data:{id,name:`${query} ${i}`,game:'POKEMON',setCode:query,cardNumber:String(i),language:i===1?'KO':'EN',edition:'NORMAL',condition:'NM',imageUrl:i===2?null:'https://example.test/card.webp',priceObservations:{create:{amount:'1000000',dataSource:'MOCK',source:'catalog test',observedAt:new Date(Date.now()-1000)}}}});
  app=await buildApp({env:parseApiEnv({NODE_ENV:'test',DATABASE_ENABLED:'true',DATABASE_URL:process.env.DATABASE_TEST_URL,CARD_DATA_SOURCE:'database'})});
  const first=(await app.inject(`/api/cards?${new URLSearchParams({q:query,limit:'1'})}`)).json().items;
  expect(first.map((c:{id:string})=>c.id)).toEqual([ids[1]]);
  const all=(await app.inject(`/api/cards?${new URLSearchParams({q:query,limit:'20'})}`)).json().items;
  expect(all.map((c:{id:string})=>c.id)).toEqual([ids[1],ids[0]]);
  expect((await app.inject(`/api/cards/${ids[2]}`)).statusCode).toBe(200);
 }finally{await app?.close();await db.priceObservation.deleteMany({where:{cardVariantId:{in:ids}}});await db.cardVariant.deleteMany({where:{id:{in:ids}}});await db.$disconnect();}
});
