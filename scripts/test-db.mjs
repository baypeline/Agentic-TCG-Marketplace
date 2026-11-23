import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';

try {
  loadEnvFile(new URL('../.env', import.meta.url));
  const url = process.env.DATABASE_TEST_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error('Missing database URL');
  console.log('Running tests with PostgreSQL integration enabled (credentials hidden).');
  const child = spawn('pnpm -r --if-present run test', {
    shell: true, stdio: 'inherit', cwd: new URL('..', import.meta.url),
    env: { ...process.env, DATABASE_TEST_URL: url },
  });
  child.on('error', () => { console.error('Could not start pnpm tests.'); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code ?? 1; });
} catch {
  console.error('Configure root .env and DATABASE_URL before running database tests.');
  process.exitCode = 1;
}
