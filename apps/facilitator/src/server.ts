import { config } from 'dotenv';
import { buildApp } from './app.js';
import { parseEnv } from './config.js';
import { createEngine } from './engine.js';
import { createJournal } from './journal.js';

config({ path: '../../infra/.env.facilitator', quiet: true });
try {
  const env = parseEnv(process.env);
  const engine = await createEngine(env);
  const journal = createJournal(env.FACILITATOR_DATA_DIR);
  const app = buildApp({ env, engine, journal });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void app.close().catch(() => { process.exitCode = 1; }); });
  await app.listen({ host: env.FACILITATOR_HOST, port: env.FACILITATOR_PORT });
  console.log(JSON.stringify({ status: 'listening', port: env.FACILITATOR_PORT, network: env.FACILITATOR_CHAIN === 'maroo' ? 'eip155:450815' : 'eip155:84532', signer: engine.address }));
} catch {
  console.error('퍼실리테이터 시작 실패. 환경변수·지갑 분리·RPC 체인·데이터 디렉터리를 확인하세요.');
  process.exitCode = 1;
}
