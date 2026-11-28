import { loadEnvFile } from 'node:process';
import { readFile,writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createOfficialImageSource } from '../src/official-images.js';
import { createPrismaClient,seedOfficialImages,officialImagesSchema } from '@tcg/db';
loadEnvFile(new URL('../../../.env',import.meta.url));
const {values}=parseArgs({options:{seed:{type:'boolean',default:false}}});
const targetsPath=new URL('../../db/fixtures/catalog/official-image-targets.json',import.meta.url);
const outputPath=new URL('../../db/fixtures/catalog/official-images.json',import.meta.url);
const targetSchema=z.object({cardVariantId:z.uuid(),name:z.string().min(1),setCode:z.string(),cardNumber:z.string().regex(/^\d{3}$/),officialCardId:z.string().regex(/^[A-Z0-9]+$/)}).strict();
try{
 const targets=z.array(targetSchema).min(1).max(15).parse(JSON.parse(await readFile(targetsPath,'utf8')));
 const source=createOfficialImageSource(),entries=[];
 for(const target of targets)entries.push(await source.collect(target));
 const pack=officialImagesSchema.parse({version:1,entries});
 await writeFile(outputPath,JSON.stringify(pack,null,2)+'\n','utf8');
 if(values.seed){const prisma=createPrismaClient(process.env.DATABASE_URL!);try{console.log(JSON.stringify(await seedOfficialImages(prisma,pack)));}finally{await prisma.$disconnect();}}
 console.log(JSON.stringify({collected:entries.length,imagesChecked:true,imageFilesStored:false}));
}catch{console.error('공식 카드 이미지 수집 실패. 대상 카드 매칭·페이지 구조·이미지 응답과 DB Migration을 확인하세요.');process.exitCode=1;}
