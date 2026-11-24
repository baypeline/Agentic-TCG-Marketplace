import { config } from 'dotenv';
import { createPrismaClient, seedDemoCatalog } from '@tcg/db';
import { demoInventory } from '../src/index.js';

config({ path: '../../.env', quiet: true });
if (!process.env.DATABASE_URL) throw new Error('루트 .env에 DATABASE_URL을 설정하세요.');
const prisma = createPrismaClient(process.env.DATABASE_URL);
try {
  await seedDemoCatalog(prisma);
  // 재실행해도 기존 소유자·매물·예약 상태를 초기화하지 않는다.
  const result = await prisma.inventoryItem.createMany({ data: demoInventory.map(item => ({ ...item })), skipDuplicates: true });
  console.log(`시연 재고 ${result.count}장을 추가했습니다. 기존 재고 상태는 유지했습니다.`);
} finally { await prisma.$disconnect(); }
