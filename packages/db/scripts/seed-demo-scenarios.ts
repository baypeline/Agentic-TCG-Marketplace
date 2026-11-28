import { loadEnvFile } from 'node:process';
import { parseArgs } from 'node:util';
import { createPrismaClient, seedDemoScenarios } from '../src/index.js';

loadEnvFile(new URL('../../../.env', import.meta.url));
if (!process.env.DATABASE_URL) throw new Error('루트 .env에 DATABASE_URL을 설정하세요.');
const { values } = parseArgs({ options: { round: { type: 'string', default: 'default' } } });
const prisma = createPrismaClient(process.env.DATABASE_URL);
try { console.log(JSON.stringify(await seedDemoScenarios(prisma, values.round, process.env.PAYMENT_CHAIN === 'maroo' ? 'maroo' : 'base-sepolia'))); }
catch { console.error('데모 시드 구성 실패. DB 연결과 기존 데모 카드의 식별 속성을 확인하세요.'); process.exitCode = 1; }
finally { await prisma.$disconnect(); }
