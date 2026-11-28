import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { createPrismaClient,readOfficialImages,seedOfficialImages } from '../src/index.js';
it.skipIf(!process.env.DATABASE_TEST_URL)('이미지 연결은 반복 가능하며 가격·판본·보존 상태와 기존 매핑을 보호한다',async()=>{
 const db=createPrismaClient(process.env.DATABASE_TEST_URL!),id=randomUUID();
 const original=(await readOfficialImages()).entries[0]!,entry={...original,cardVariantId:id};
 const condition=`IMAGE_TEST_${id}`;
 try{
  await db.cardVariant.create({data:{id,game:'POKEMON',name:entry.name,setCode:entry.setCode,cardNumber:entry.cardNumber,language:'KO',edition:'UNSPECIFIED',condition,imageUrl:null,priceObservations:{create:{amount:'123',dataSource:'MOCK',source:'image test',observedAt:new Date()}}}});
  const before=await db.priceObservation.findMany({where:{cardVariantId:id}});
  const input={version:1,entries:[entry]};await seedOfficialImages(db,input);await seedOfficialImages(db,input);
  expect(await db.cardImageReference.count({where:{cardVariantId:id}})).toBe(1);
  expect(await db.cardVariant.findUnique({where:{id}})).toMatchObject({imageUrl:entry.imageUrl,edition:'UNSPECIFIED',condition});
  expect(await db.priceObservation.findMany({where:{cardVariantId:id}})).toEqual(before);
  await expect(seedOfficialImages(db,{version:1,entries:[{...entry,officialCardId:'OTHER',sourceUrl:'https://pokemoncard.co.kr/cards/detail/OTHER'}]})).rejects.toThrow();
  await expect(seedOfficialImages(db,{version:1,entries:[{...entry,name:'다른 이름'}]})).rejects.toThrow();
  expect((await db.cardImageReference.findUniqueOrThrow({where:{cardVariantId:id}})).officialCardId).toBe(entry.officialCardId);
 }finally{await db.priceObservation.deleteMany({where:{cardVariantId:id}});await db.cardVariant.deleteMany({where:{id}});await db.$disconnect();}
});
