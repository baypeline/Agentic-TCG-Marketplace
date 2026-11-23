import { loadEnvFile } from 'node:process';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createAggregatorService, createInMemoryCardIdentityStore, createPrismaCardIdentityStore, createTcgdexCardAdapter, TcgdexAdapterError } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  if (process.argv.includes('--database')) {
    loadEnvFile(new URL('../../../.env', import.meta.url));
    if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
    prisma = createPrismaClient(process.env.DATABASE_URL);
    await prisma.$connect();
  }
  const identityStore = prisma ? createPrismaCardIdentityStore(prisma) : createInMemoryCardIdentityStore();
  const service = createAggregatorService({ adapter: createTcgdexCardAdapter({ identityStore }) });
  const cards = await service.searchCards({ query: 'Pikachu', limit: 1 });
  if (!cards[0]) throw new Error('No card found');
  const detail = await service.getCardVariant(cards[0].id);
  if (!detail || detail.id !== cards[0].id) throw new Error('Card identity mismatch');
  console.log(`TCGdex 검색·상세 확인: ${detail.name} / ${detail.setCode} / ${detail.cardNumber} (${detail.language})`);
  console.log(`내부 UUID: ${detail.id} / 매핑 저장소: ${prisma ? 'PostgreSQL' : '메모리(시연용)'}`);
  console.log('에디션·보존 상태는 UNSPECIFIED입니다. 이 명령은 매핑만 확인하며 본문 저장은 pnpm cards:collect로 실행합니다.');
} catch (error) {
  console.error(error instanceof TcgdexAdapterError ? `외부 카드 API 검증 실패: ${error.reason}` : '외부 카드 API 검색·상세 검증에 실패했습니다.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
