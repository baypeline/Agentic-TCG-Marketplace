import { loadEnvFile } from 'node:process';
import { createPrismaClient,readOfficialImages,seedOfficialImages } from '../src/index.js';
loadEnvFile(new URL('../../../.env',import.meta.url));
const prisma=createPrismaClient(process.env.DATABASE_URL!);
try{console.log(JSON.stringify(await seedOfficialImages(prisma,await readOfficialImages())));}
catch{console.error('공식 이미지 seed 실패. 수집 카드·공식 매핑·DB Migration을 확인하세요.');process.exitCode=1;}
finally{await prisma.$disconnect();}
