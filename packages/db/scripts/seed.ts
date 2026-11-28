import { config } from 'dotenv';
import { createPrismaClient, seedDemoCatalog } from '../src/index.js';

config({ path: '../../.env', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('루트 .env에 DATABASE_URL을 설정하세요.');
if (process.env.PAYMENT_CHAIN === 'maroo') throw new Error('tOKRW DB에는 demo:seed를 사용하세요.');
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  await seedDemoCatalog(prisma);
  console.log('시연 카드 3개와 MOCK 가격 표본 6개를 저장했습니다.');
} finally { await prisma.$disconnect(); }
