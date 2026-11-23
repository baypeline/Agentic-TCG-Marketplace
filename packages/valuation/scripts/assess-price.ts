import { loadEnvFile } from 'node:process';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { AppError } from '@tcg/contracts';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { assessmentInputSchema, createMarketPriceServices } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  const { values } = parseArgs({ options: { file: { type: 'string' } } });
  if (!values.file) throw new Error('Missing file');
  const input = assessmentInputSchema.parse(JSON.parse(await readFile(values.file, 'utf8')));
  loadEnvFile(new URL('../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const result = await createMarketPriceServices({ prisma }).assessPrice(input);
  console.log(JSON.stringify({ snapshotId: result.snapshotId, usdcAmount: result.usdcAmount, assessedAt: result.assessedAt }));
} catch (error) {
  console.error(error instanceof AppError ? error.message : '가격 검증 기록 실패. JSON 파일, 카드 속성, 환율 근거 및 DB 연결을 확인하세요.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
