import { randomBytes } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';

const envPath = new URL('../.env', import.meta.url);
const listeners = [];

async function allocatePort() {
  const server = createServer();
  listeners.push(server);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return server.address().port;
}

try {
  // 생성 중에는 소켓을 유지하여 세 포트가 중복되지 않도록 한다.
  const webPort = await allocatePort();
  const apiPort = await allocatePort();
  const dbPort = await allocatePort();
  const suffix = randomBytes(4).toString('hex');
  const user = `tcg_${suffix}`;
  const database = `tcg_${suffix}`;
  const password = randomBytes(32).toString('base64url');
  const content = [
    '# Local development only. Do not commit this file.',
    'NODE_ENV=development',
    `PORT=${webPort}`,
    'API_HOST=127.0.0.1',
    `API_PORT=${apiPort}`,
    `CORE_API_URL=http://127.0.0.1:${apiPort}`,
    'DATA_MODE=mock',
    'CARD_DATA_SOURCE=mock',
    'PRICE_DATA_SOURCE=mock',
    'DATABASE_ENABLED=false',
    `AGENT_LOCAL_SECRET=${randomBytes(32).toString('base64url')}`,
    `POSTGRES_USER=${user}`,
    `POSTGRES_PASSWORD=${password}`,
    `POSTGRES_DB=${database}`,
    `POSTGRES_PORT=${dbPort}`,
    `DATABASE_URL=postgresql://${user}:${password}@127.0.0.1:${dbPort}/${database}?schema=public`,
    '',
  ].join('\n');
  // 기존 설정은 덮어쓰지 않는다. POSIX 환경에서는 소유자에게만 읽기·쓰기를 허용한다.
  await writeFile(envPath, content, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
  console.log(`Created .env (credentials hidden). Web: http://127.0.0.1:${webPort}; API: http://127.0.0.1:${apiPort}; PostgreSQL port: ${dbPort}`);
} catch (error) {
  console.error(error.code === 'EEXIST' ? '.env already exists; left unchanged.' : 'Could not create .env. Check filesystem permissions and available local ports.');
  process.exitCode = 1;
} finally {
  await Promise.all(listeners.filter(server => server.listening).map(server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))));
}
