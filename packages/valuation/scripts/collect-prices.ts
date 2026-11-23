import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppError, idSchema } from '@tcg/contracts';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createMarketPriceServices, createTcgdexPriceProvider } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  const { values } = parseArgs({ options: { 'card-id': { type: 'string' }, limit: { type: 'string', default: '20' } } });
  const cardId = values['card-id'] ? idSchema.parse(values['card-id']) : undefined;
  const limit = z.coerce.number().int().min(1).max(500).parse(values.limit);
  loadEnvFile(new URL('../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const service = createMarketPriceServices({ prisma, provider: createTcgdexPriceProvider() });
  const cards = cardId ? [{ id: cardId }] : await prisma.cardVariant.findMany({ where: { language: 'EN', externalIdentity: { provider: 'TCGDEX', language: 'EN' } }, select: { id: true }, orderBy: { id: 'asc' }, take: limit });
  // 순차 실행으로 외부 API 부하를 제한한다. 실패 시 앞선 카드의 완료 결과는 유지한다.
  for (const card of cards) console.log(JSON.stringify(await service.collectPrices(card.id)));
  console.log('참고 시세 저장 완료. 검증되지 않은 판본·환율은 USDC 적정가에 반영하지 않습니다.');
} catch (error) {
  console.error(error instanceof AppError ? error.message : '가격 수집 실패. 옵션과 DB 연결 및 Migration을 확인하세요.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
