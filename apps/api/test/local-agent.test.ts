import { createLocalAgentToken } from '@tcg/config/local-agent-auth';
import { parseApiEnv } from '@tcg/config';
import { expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createLocalAgentOptions } from '../src/local-agent.js';

const secret = 'local-agent-integration-test-secret';
const variables = { AGENT_LOCAL_SECRET: secret, OPENAI_API_KEY: 'test-key' };

it('로컬 서버에서 서명된 브라우저만 자기 세션에 접근한다', async () => {
  const env = parseApiEnv({ NODE_ENV: 'development' });
  const app = await buildApp({ env, ...createLocalAgentOptions(env, variables) });
  const sessions = '/api/agent/sessions';
  const token = createLocalAgentToken(secret);
  const owner = { authorization: `Bearer ${token}` };
  try {
    const forged = await app.inject({ method: 'POST', url: sessions, headers: {
      authorization: `Bearer ${token.slice(0, -1)}!`, 'x-user-id': 'forged',
    } });
    expect(forged.statusCode).toBe(401);
    const created = await app.inject({ method: 'POST', url: sessions, headers: owner });
    expect(created.statusCode).toBe(201);
    const url = `${sessions}/${created.json().id}`;
    expect((await app.inject({ url, headers: owner })).statusCode).toBe(200);
    const other = { authorization: `Bearer ${createLocalAgentToken(secret)}` };
    expect((await app.inject({ url, headers: other })).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});

it.each([
  { NODE_ENV: 'production' },
  { NODE_ENV: 'development', API_HOST: '0.0.0.0' },
])('공개 주소나 운영 모드에서 로컬 세션 인증을 활성화하지 않는다', input => {
  expect(createLocalAgentOptions(parseApiEnv(input), variables)).toEqual({});
});
