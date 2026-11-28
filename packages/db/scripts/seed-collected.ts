import { config } from 'dotenv';
import { createPrismaClient, readCatalogFixtures, seedCollectedCatalog,readOfficialImages,seedOfficialImages } from '../src/index.js';

config({ path: '../../.env', quiet: true });
let prisma: ReturnType<typeof createPrismaClient> | undefined;
try {
  const data = await readCatalogFixtures();
  if (!process.env.DATABASE_URL) throw new Error('Missing database URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  console.log(JSON.stringify(await seedCollectedCatalog(prisma, data)));
  console.log(JSON.stringify(await seedOfficialImages(prisma,await readOfficialImages())));
  console.log('수집 데이터 seed 완료. 원본 시각을 유지했으며 가격 검증 기록과 Mock 표본은 변경하지 않았습니다.');
} catch {
  console.error('수집 데이터 seed 실패. JSON 무결성, 기존 식별자 충돌, DB 설정과 Migration을 확인하세요. 기존 데이터를 덮어쓰지 않습니다.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
