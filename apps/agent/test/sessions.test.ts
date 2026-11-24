import Fastify, { type FastifyRequest } from 'fastify';
import { AppError, type AuthContext } from '@tcg/contracts';
import { afterEach, expect, it, vi } from 'vitest';
import { createAgentSessionPlugin, type AgentSessionPluginOptions } from '../src/index.js';
import { demoCards } from '@tcg/contracts/fixtures';

const apps: ReturnType<typeof Fastify>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); vi.useRealTimers(); });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

async function setup(runAgentTurn: AgentSessionPluginOptions['runtime']['runAgentTurn'], lifecycle: Pick<AgentSessionPluginOptions, 'onSessionStarted' | 'onSessionStopped'> = {}) {
  const app = Fastify();
  apps.push(app);

  function requireAuth(request: FastifyRequest): AuthContext {
    // 테스트에서만 고정 토큰을 검증된 인증 컨텍스트로 변환한다.
    switch (request.headers.authorization) {
      case 'Bearer owner': return { userId: 'alice', agentId: 'agent-1' };
      case 'Bearer other-agent': return { userId: 'alice', agentId: 'agent-2' };
      case 'Bearer other-user': return { userId: 'bob', agentId: 'agent-1' };
      default: throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
    }
  }

  await app.register(createAgentSessionPlugin({ runtime: { runAgentTurn }, requireAuth, ...lifecycle }), { prefix: '/api' });
  return app;
}

const baseUrl = '/api/agent/sessions';
const owner = { authorization: 'Bearer owner' };

async function createSession(app: Awaited<ReturnType<typeof setup>>) {
  const response = await app.inject({ method: 'POST', url: baseUrl, headers: owner });
  expect(response.statusCode).toBe(201);
  const { id } = response.json<{ id: string }>();
  return `${baseUrl}/${id}`;
}

it('같은 응답의 선택 후보를 SSE와 소유자 세션에 보존하고 다음 턴에는 재사용하지 않는다', async () => {
  let turn = 0;
  const app = await setup(async (_message, options) => {
    if (turn++ === 0) options?.onCardChoices?.([demoCards[0]!]);
    return '조회 응답';
  });
  const url = await createSession(app);
  const send = () => app.inject({ method: 'POST', url: `${url}/messages`, headers: owner, payload: { message: '조회' } });
  const first = await send();
  expect(first.body).toContain('"cardChoices"');
  expect(first.body).toContain(demoCards[0]!.id);
  expect((await send()).body).not.toContain('"cardChoices"');
  const session = await app.inject({ url, headers: owner });
  expect(session.json().messages[1].cardChoices).toEqual([demoCards[0]]);
});

it('세션 소유자의 메시지를 SSE로 처리하고 이전 턴을 다음 모델 호출에 전달한다', async () => {
  const runAgentTurn = vi.fn<AgentSessionPluginOptions['runtime']['runAgentTurn']>()
    .mockResolvedValueOnce('Pikachu SV 025를 찾았습니다.')
    .mockResolvedValueOnce('시연용 적정가는 12 USDC입니다.');
  const app = await setup(runAgentTurn);
  const url = await createSession(app);

  const send = (message: string) => app.inject({
    method: 'POST', url: `${url}/messages`, headers: owner, payload: { message },
  });
  const first = await send('피카츄 찾아줘');
  expect(first.headers['content-type']).toMatch(/^text\/event-stream/);
  expect(first.body).toMatch(/^event: started/);
  expect(first.body).toContain('event: completed');

  const followUp = await send('그 카드 얼마야?');
  expect(followUp.body).toContain('12 USDC');
  expect(runAgentTurn.mock.calls[1]).toEqual(['그 카드 얼마야?', expect.objectContaining({
    history: [
      { role: 'user', content: '피카츄 찾아줘' },
      { role: 'assistant', content: 'Pikachu SV 025를 찾았습니다.' },
    ],
    signal: expect.any(AbortSignal),
  })]);
  const session = await app.inject({ url, headers: owner });
  expect(session.json().messages).toHaveLength(4);
});

it('인증 및 사용자와 Agent 소유권을 검증하고 빈 입력을 거부한다', async () => {
  const runAgentTurn = vi.fn();
  const app = await setup(runAgentTurn);
  expect((await app.inject({ method: 'POST', url: baseUrl, headers: { 'x-user-id': 'alice' } })).statusCode).toBe(401);
  const url = await createSession(app);
  for (const token of ['other-user', 'other-agent']) {
    const headers = { authorization: `Bearer ${token}` };
    expect((await app.inject({ url, headers })).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: `${url}/messages`, headers, payload: { message: '피카츄 찾아줘' } })).statusCode).toBe(404);
  }
  const blank = await app.inject({ method: 'POST', url: `${url}/messages`, headers: owner, payload: { message: '  ' } });
  expect(blank.statusCode).toBe(400);
  expect(runAgentTurn).not.toHaveBeenCalled();
});

it('처리 중인 턴과 겹치는 요청을 막고 실패 후 재요청을 허용한다', async () => {
  const started = deferred<void>();
  const turn = deferred<string>();
  const runAgentTurn = vi.fn()
    .mockImplementationOnce(() => { started.resolve(); return turn.promise; })
    .mockResolvedValueOnce('다시 조회했습니다.');
  const app = await setup(runAgentTurn);
  const url = await createSession(app);
  const send = () => app.inject({ method: 'POST', url: `${url}/messages`, headers: owner, payload: { message: '피카츄 찾아줘' } });
  const first = Promise.resolve(send());

  try {
    await started.promise;
    const concurrent = await send();
    expect(concurrent.statusCode).toBe(409);
    expect(concurrent.json().code).toBe('SESSION_BUSY');
  } finally {
    turn.reject(new Error('외부 호출 실패 세부 정보'));
  }

  const failed = await first;
  expect(failed.body).toContain('event: error');
  expect(failed.body).not.toContain('외부 호출 실패 세부 정보');
  expect((await app.inject({ url, headers: owner })).json().messages).toEqual([]);
  expect((await send()).body).toContain('event: completed');
});

it('SSE 연결이 끊겨도 서버 작업을 계속하고 재접속으로 결과를 조회한다', async () => {
  const result = deferred<string>();
  let executionSignal: AbortSignal | undefined;
  const app = await setup(async (_message, options) => { executionSignal = options?.signal; return result.promise; });
  const base = await app.listen({ port: 0, host: '127.0.0.1' });
  const url = await createSession(app);
  const response = await fetch(`${base}${url}/messages`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ message: '피카츄 찾아줘' }) });
  const reader = response.body!.getReader();
  expect(new TextDecoder().decode((await reader.read()).value)).toContain('event: started');
  await reader.cancel();
  expect(executionSignal?.aborted).toBe(false);
  result.resolve('연결이 없어도 완료');
  await expect.poll(async () => (await app.inject({ url, headers: owner })).json().messages.length).toBe(2);
  expect((await app.inject({ url, headers: owner })).json().status).toBe('RUNNING');
});

it('세션 중단은 호스트에 알리고 실행 중인 턴과 신규 실행을 중단한다', async () => {
  const started = deferred<void>();
  const onSessionStarted = vi.fn(async () => {});
  const onSessionStopped = vi.fn(async () => {});
  const run = vi.fn<AgentSessionPluginOptions['runtime']['runAgentTurn']>(async (_message, options) => {
    started.resolve();
    return new Promise<string>((_resolve, reject) => {
      options!.signal!.addEventListener('abort', () => reject(new Error('stopped')), { once: true });
    });
  });
  const app = await setup(run, { onSessionStarted, onSessionStopped });
  const url = await createSession(app);
  expect(onSessionStarted).toHaveBeenCalledTimes(1);
  const turn = Promise.resolve(app.inject({ method: 'POST', url: `${url}/messages`, headers: owner, payload: { message: '피카츄 찾아줘' } }));
  await started.promise;
  expect((await app.inject({ method: 'POST', url: `${url}/stop`, headers: { authorization: 'Bearer other-user' } })).statusCode).toBe(404);
  expect(onSessionStopped).not.toHaveBeenCalled();
  const stops = await Promise.all([app.inject({ method: 'POST', url: `${url}/stop`, headers: owner }), app.inject({ method: 'POST', url: `${url}/stop`, headers: owner })]);
  expect(stops.map(result => result.json().status)).toEqual(['STOPPED', 'STOPPED']);
  await turn;
  expect(onSessionStopped).toHaveBeenCalledTimes(1);
  expect(onSessionStopped).toHaveBeenCalledWith({ userId: 'alice', agentId: 'agent-1' }, url.split('/').at(-1));
  expect((await app.inject({ method: 'POST', url: `${url}/messages`, headers: owner, payload: { message: '다시 찾아줘' } })).statusCode).toBe(409);
});

it('만료된 세션과 호스트 종료를 호스트의 중단 처리에 전달한다', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  const onSessionStopped = vi.fn(async () => {});
  const app = await setup(vi.fn(async () => 'ok'), { onSessionStopped });
  const first = await createSession(app);
  vi.setSystemTime(Date.now() + 60 * 60 * 1000 + 1);
  expect((await app.inject({ url: first, headers: owner })).statusCode).toBe(404);
  expect(onSessionStopped).toHaveBeenCalledTimes(1);
  await createSession(app);
  await app.close();
  apps.splice(apps.indexOf(app), 1);
  expect(onSessionStopped).toHaveBeenCalledTimes(2);
});
