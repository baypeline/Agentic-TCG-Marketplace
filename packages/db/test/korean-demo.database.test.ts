import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { createPrismaClient,readDemoScenarios,seedDemoScenarios,demoRowId,readOfficialImages } from '../src/index.js';
it('한국어 거래용 카드 12종은 원본과 다른 UUID·공식 이미지·정책 상한 이내 가격을 사용한다',async()=>{
 const [pack,official]=await Promise.all([readDemoScenarios('maroo',true),readOfficialImages()]);
 expect(pack.scenarios).toHaveLength(15);const ko=pack.scenarios.slice(3);
 expect(ko).toHaveLength(12);
 for(const scene of ko){expect(scene.cardId).not.toBe(scene.sourceCardId);expect(official.entries.some(e=>e.cardVariantId===scene.sourceCardId)).toBe(true);expect(BigInt(scene.listingPrices[1]!)).toBeLessThanOrEqual(25n*10n**18n);expect(scene.observedAt).toBe('2026-11-28T00:00:00.000Z');}
});
it.skipIf(!process.env.DATABASE_TEST_URL)('한국어 시드를 반복해도 판매·소유권을 되돌리지 않고 원본 상태를 보존한다',async()=>{
 const db=createPrismaClient(process.env.DATABASE_TEST_URL!),pack=await readDemoScenarios('base-sepolia',true),ko=pack.scenarios.slice(3),round=`ko-test-${randomUUID().slice(0,12)}`;
 const cardIds=ko.map(s=>s.cardId),existing=await db.cardVariant.findMany({where:{id:{in:cardIds}},select:{id:true}}),created=cardIds.filter(id=>!existing.some(c=>c.id===id));
 const inventoryIds=pack.scenarios.flatMap(s=>s.listingPrices.map((_,i)=>demoRowId(`inventory:${round}:${s.id}:${i}`)));
 const sourceBefore=await db.cardVariant.findUniqueOrThrow({where:{id:ko[0]!.sourceCardId}});
 try{
  expect((await seedDemoScenarios(db,round,'base-sepolia',true)).inventory).toBe(30);
  const first=ko[0]!,inventoryId=demoRowId(`inventory:${round}:${first.id}:0`),listingId=demoRowId(`listing:${round}:${first.id}:0`),ownerId=randomUUID();
  await db.listing.update({where:{id:listingId},data:{status:'SOLD'}});await db.inventoryItem.update({where:{id:inventoryId},data:{ownerId,status:'AVAILABLE'}});
  expect(await seedDemoScenarios(db,round,'base-sepolia',true)).toMatchObject({cards:0,inventory:0,listings:0});
  expect(await db.inventoryItem.findUnique({where:{id:inventoryId}})).toMatchObject({ownerId,status:'AVAILABLE'});expect(await db.listing.findUnique({where:{id:listingId}})).toMatchObject({status:'SOLD'});
  expect(await db.cardVariant.findUniqueOrThrow({where:{id:first.sourceCardId}})).toEqual(sourceBefore);
  expect(await db.cardVariant.findUnique({where:{id:first.cardId},include:{imageReference:true}})).toMatchObject({language:'KO',edition:'NORMAL',condition:'NM',imageReference:{provider:'POKEMON_KOREA'}});
  expect(await db.priceObservation.findUnique({where:{id:demoRowId(`price:${first.id}`)}})).toMatchObject({amount:first.referencePrice,dataSource:'MOCK'});
 }finally{await db.listing.deleteMany({where:{inventoryItemId:{in:inventoryIds}}});await db.inventoryItem.deleteMany({where:{id:{in:inventoryIds}}});await db.priceObservation.deleteMany({where:{cardVariantId:{in:created}}});await db.cardVariant.deleteMany({where:{id:{in:created}}});await db.$disconnect();}
});
