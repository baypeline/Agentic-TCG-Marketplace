import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { AppError } from '@tcg/contracts';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createPrismaCardIdentityStore, createSetCollectionService, createTcgdexSetSource } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  const { values } = parseArgs({ options: { set: { type: 'string' }, language: { type: 'string', default: 'en' }, 'batch-size': { type: 'string', default: '20' }, 'max-batches': { type: 'string', default: '2000' }, refresh: { type: 'boolean', default: false } } });
  const language = z.enum(['en', 'ko']).parse(values.language);
  if (!values.set) throw new Error('Missing set');
  const batchSize = z.coerce.number().int().min(1).max(20).parse(values['batch-size']);
  const maxBatches = z.coerce.number().int().min(1).max(2000).parse(values['max-batches']);
  loadEnvFile(new URL('../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error('Missing database URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const service = createSetCollectionService({ prisma, language, source: createTcgdexSetSource({ language, identityStore: createPrismaCardIdentityStore(prisma) }) });
  const result = await service.collectSet({ setId: values.set, batchSize, maxBatches, refresh: values.refresh, onProgress: value => console.log(JSON.stringify(value)) });
  console.log(JSON.stringify(result));
} catch (error) {
  console.error(error instanceof AppError ? error.message : '세트 수집 실패. 옵션·DB·Migration을 확인하세요. 같은 명령으로 저장된 체크포인트부터 다시 실행할 수 있습니다.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
