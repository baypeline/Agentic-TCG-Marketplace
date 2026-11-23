import { config } from 'dotenv';
import { parseApiEnv } from '@tcg/config';
import { buildApp } from './app.js';
import { createLocalAgentOptions } from './local-agent.js';

config({ path: '../../.env', quiet: true });
const env = parseApiEnv(process.env);
const app = await buildApp({ env, logger: true, ...createLocalAgentOptions(env, process.env) });
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => { void app.close().catch(error => { app.log.error(error); process.exitCode = 1; }); });
}
try { await app.listen({ host: env.API_HOST, port: env.API_PORT }); }
catch (error) { app.log.error(error); await app.close(); process.exitCode = 1; }
