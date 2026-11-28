import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { PrismaClient } from './generated/prisma/client.js';

const text=z.string().trim().min(1);
export const officialImageEntrySchema=z.object({cardVariantId:z.uuid(),provider:z.literal('POKEMON_KOREA'),officialCardId:text.regex(/^[A-Z0-9]+$/),name:text,setCode:text.regex(/^[A-Z0-9]+$/),cardNumber:text.regex(/^\d{3}$/),printedNumber:text.regex(/^\d{3}\/\d{3}$/),productName:text,sourceUrl:z.url(),imageUrl:z.url(),contentSha256:z.string().regex(/^[a-f0-9]{64}$/),byteLength:z.number().int().min(100).max(2_000_000),verifiedAt:z.iso.datetime()}).strict().superRefine((value,ctx)=>{
 const source=new URL(value.sourceUrl),image=new URL(value.imageUrl);
 if(source.origin!=='https://pokemoncard.co.kr'||source.pathname!==`/cards/detail/${value.officialCardId}`||source.search||source.hash||source.username||source.password)ctx.addIssue({code:'custom',message:'공식 상세 URL이 일치하지 않습니다.'});
 const suffix=`/${value.setCode}/${value.setCode}_${value.cardNumber}.webp`;
 const params=[...image.searchParams.keys()];
 if(image.origin!=='https://pokemoncard.co.kr'||!image.pathname.startsWith('/public-assets/home/data/cards.image_www/data/wmimages/')||!image.pathname.endsWith(suffix)||image.username||image.password||image.hash||image.searchParams.get('w')!=='512'||params.some(k=>!['w','v'].includes(k))||new Set(params).size!==params.length||(image.searchParams.has('v')&&!/^\d+$/.test(image.searchParams.get('v')!)))ctx.addIssue({code:'custom',message:'공식 이미지의 세트·카드 번호가 일치하지 않습니다.'});
 if(value.printedNumber.split('/')[0]!==value.cardNumber)ctx.addIssue({code:'custom',message:'인쇄 번호가 일치하지 않습니다.'});
});
export const officialImagesSchema=z.object({version:z.literal(1),entries:z.array(officialImageEntrySchema).min(1).max(30)}).strict().superRefine((value,ctx)=>{
 if(new Set(value.entries.map(e=>e.cardVariantId)).size!==value.entries.length||new Set(value.entries.map(e=>e.officialCardId)).size!==value.entries.length)ctx.addIssue({code:'custom',message:'공식 이미지 식별자가 중복됩니다.'});
});
export type OfficialImageEntry=z.infer<typeof officialImageEntrySchema>;
export async function readOfficialImages(){return officialImagesSchema.parse(JSON.parse(await readFile(new URL('../fixtures/catalog/official-images.json',import.meta.url),'utf8')));}
const same=(a:string,b:string)=>a.normalize('NFKC').replace(/\s+/g,' ').trim()===b.normalize('NFKC').replace(/\s+/g,' ').trim();
/** Only the image URL and its provenance are changed; prices/condition/ownership remain untouched. */
export async function seedOfficialImages(prisma:PrismaClient,input:unknown){
 const pack=officialImagesSchema.parse(input);
 return prisma.$transaction(async tx=>{
  for(const entry of pack.entries){
   const card=await tx.cardVariant.findUnique({where:{id:entry.cardVariantId}});
   if(!card||card.language!=='KO'||card.setCode!==entry.setCode||card.cardNumber!==entry.cardNumber||!same(card.name,entry.name))throw new Error('공식 이미지와 기존 카드의 언어·이름·세트·번호가 다릅니다.');
   const old=await tx.cardImageReference.findUnique({where:{cardVariantId:card.id}});
   if(old&&(old.provider!==entry.provider||old.officialCardId!==entry.officialCardId))throw new Error('기존 공식 이미지 매핑과 충돌합니다.');
   if(card.imageUrl&&card.imageUrl!==entry.imageUrl&&(!old||old.imageUrl!==card.imageUrl))throw new Error('다른 출처의 카드 이미지를 덮어쓰지 않습니다.');
   const data={...entry,verifiedAt:new Date(entry.verifiedAt)};
   await tx.cardImageReference.upsert({where:{cardVariantId:card.id},create:data,update:data});
   if(card.imageUrl!==entry.imageUrl)await tx.cardVariant.update({where:{id:card.id},data:{imageUrl:entry.imageUrl}});
  }
  return {linkedImages:pack.entries.length};
 });
}
