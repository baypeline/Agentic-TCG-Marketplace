import { readFile, writeFile, copyFile } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { constants } from 'node:fs';
import { parse } from 'dotenv';

const root = new URL('../../../', import.meta.url), path = new URL('.env', root);
try {
  let content = await readFile(path, 'utf8'); const current = parse(content);
  const base = current.BASE_SEPOLIA_DATABASE_URL || (current.PAYMENT_CHAIN !== 'maroo' ? current.DATABASE_URL : undefined);
  if (!base || !current.AGENT_SERVER_PRIVATE_KEY || !current.AGENT_SERVER_WALLET_ADDRESS || !current.POSTGRES_USER) throw new Error();
  const original = new URL(base), next = new URL(base);
  const name = original.pathname.slice(1).slice(0, 50) + '_maroo';
  if (!/^[a-zA-Z0-9_]{1,63}$/.test(name)) throw new Error();
  next.pathname = '/' + name;
  if (current.PAYMENT_CHAIN !== 'maroo') await copyFile(path, new URL('.env.base-sepolia', root), constants.COPYFILE_EXCL).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const psql = sql => execFileSync('docker', ['compose', '--env-file', '.env', '-f', 'infra/compose.yaml', 'exec', '-T', 'postgres', 'psql', '-U', current.POSTGRES_USER, '-d', 'postgres', '-At', '-c', sql], { cwd: fileURLToPath(root), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (psql(`SELECT 1 FROM pg_database WHERE datname='${name}'`) !== '1') psql(`CREATE DATABASE "${name}"`);
  const env = { ...process.env, DATABASE_URL: next.href, PAYMENT_CHAIN: 'maroo' };
  for (const command of ['pnpm db:migrate', 'pnpm db:seed:collected', 'pnpm demo:seed']) {
    const result = spawnSync(command, { cwd: fileURLToPath(root), shell: true, stdio: 'inherit', env });
    if (result.status !== 0) throw new Error();
  }
  for (const [name, value] of Object.entries({ BASE_SEPOLIA_DATABASE_URL: base, DATABASE_TEST_URL: current.DATABASE_TEST_URL || base, DATABASE_URL: next.href, PAYMENT_CHAIN: 'maroo', AGENT_SIGNING_MODE: 'server', PRICE_DATA_SOURCE: 'mock' })) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    if ([...content.matchAll(new RegExp(`^${name}=`, 'gm'))].length > 1) throw new Error();
    content = pattern.test(content) ? content.replace(pattern, () => `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(path, content, { mode: 0o600 });
  console.log(JSON.stringify({ chain: 'Maroo Testnet', currency: 'tOKRW', decimals: 18, legacyDatabasePreserved: true, newDatabase: name }));
  console.log('pnpm facilitator:init 및 pnpm facilitator:up 실행 후 API·Web을 재시작하세요. 기존 Base 설정은 .env.base-sepolia에 보존했습니다.');
} catch { console.error('마루 DB 초기화 실패. Docker PostgreSQL·원본 DB URL·전용 지갑과 새 DB의 통화 상태를 확인하세요. 비밀값은 출력하지 않습니다.'); process.exitCode = 1; }
