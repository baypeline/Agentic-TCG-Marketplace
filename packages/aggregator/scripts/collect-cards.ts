import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { AppError, cardSearchQuerySchema } from '@tcg/contracts';
import { createCardCollectionService, createPrismaCardAdapter, createPrismaCardCatalogWriter, createPrismaCardIdentityStore, createTcgdexCardAdapter, CardCollectionError, TcgdexAdapterError } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  const { values } = parseArgs({ options: { query: { type: 'string', short: 'q', default: 'Pikachu' }, limit: { type: 'string', short: 'l', default: '5' }, language: { type: 'string', default: 'en' } } });
  const language = z.enum(['en', 'ko']).parse(values.language);
  const { q, limit } = cardSearchQuerySchema.parse({ q: values.query, limit: values.limit });
  loadEnvFile(new URL('../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  await prisma.$connect();
  let providerQuery = q;
  if (language === 'en' && /[가-힣]/.test(q)) {
    const matches = await prisma.pokemonNameTranslation.findMany({ where: { koreanName: q.normalize('NFKC') }, select: { englishName: true } });
    if (matches.length !== 1) throw new AppError('VALIDATION_ERROR', '한국어 수집은 사전에 있는 정확한 종명을 입력하세요. 먼저 pnpm cards:localize를 실행하거나 영문 검색어를 사용하세요.', 400);
    providerQuery = matches[0]!.englishName;
  }
  const collection = createCardCollectionService({
    source: createTcgdexCardAdapter({ language, identityStore: createPrismaCardIdentityStore(prisma) }),
    writer: createPrismaCardCatalogWriter(prisma),
  });
  const result = await collection.collectCards({ query: providerQuery, limit });
  // 트랜잭션 완료 후 일반 DB 조회 경로에서도 저장된 UUID를 확인한다.
  const reader = createPrismaCardAdapter(prisma);
  for (const card of result.items) {
    if ((await reader.getCardVariant(card.id))?.id !== card.id) throw new Error('Stored card verification failed');
  }
  console.log(JSON.stringify({ query: q, providerQuery, language, ...result }, null, 2));
  console.log('수집 카드 DB 저장·조회 확인 완료. 가격 표본은 수집하지 않았습니다.');
} catch (error) {
  console.error(error instanceof CardCollectionError || error instanceof TcgdexAdapterError ? `카드 수집 실패: ${error.reason} / ${error.message}` : error instanceof AppError ? `카드 수집 실패: ${error.message}` : '카드 수집에 실패했습니다. 옵션, DB 환경변수, Migration과 연결 상태를 확인하세요.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
