import { loadEnvFile } from 'node:process';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createPokeApiNameProvider, createPokemonLocalizationService, PokemonNameImportError } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  loadEnvFile(new URL('../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const result = await createPokemonLocalizationService({ prisma, provider: createPokeApiNameProvider() }).importNames();
  console.log(JSON.stringify(result, null, 2));
  console.log('한국어 종명 사전과 카드 표시 이름을 저장했습니다. 인쇄 언어·원문명·UUID는 유지했습니다.');
} catch (error) {
  console.error(error instanceof PokemonNameImportError ? `한국어 이름 가져오기 실패: ${error.reason}` : '한국어 이름 저장에 실패했습니다. DB 환경변수와 Migration을 확인하세요.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
