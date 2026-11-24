import { afterEach, expect, it, vi } from 'vitest';
import { parseApiEnv } from '@tcg/config';
import { AppError } from '@tcg/contracts';
import { createLocalAgentToken } from '@tcg/config/local-agent-auth';
import { buildApp } from '../src/app.js';
import { createIntegrationPlugins } from '../src/integrations.js';
import { createLocalAgentOptions } from '../src/local-agent.js';

// 모델 네트워크만 대체한다. 카드 서비스는 실제 MCP HTTP 왕복을 사용한다.
vi.mock('@tcg/agent', async importOriginal => {
  const actual = await importOriginal<typeof import('@tcg/agent')>();
  return { ...actual, createAgentRuntime: (deps: Parameters<typeof actual.createAgentRuntime>[0]) => ({
    async runAgentTurn(message: string, options?: import('@tcg/agent').AgentTurnOptions) {
      if (message === 'direct') return '카드 이름을 알려주세요.';
      const cards = await deps.aggregatorService.searchCards({ query: 'Pikachu', limit: 10 });
      if (message === 'choices') options?.onCardChoices?.(cards);
      const content = message === 'valuation'
        ? JSON.stringify(await deps.valuationService.getValuation(cards[0]!.id))
        : '카드를 선택해 주세요.';
      await options?.onTextDelta?.(content);
      return content;
    },
  }) };
});

const apps: Awaited<ReturnType<typeof buildApp>>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map(app => app.close())); });

async function setup(isMcpUnavailable = () => false) {
  const env = parseApiEnv({ NODE_ENV: 'development' });
  const secret = 'local-agent-mcp-integration-test-secret';
  const local = createLocalAgentOptions(env, { AGENT_LOCAL_SECRET: secret, OPENAI_API_KEY: 'test-only' });
  let search!: ReturnType<typeof vi.spyOn>;
  let valuation!: ReturnType<typeof vi.spyOn>;
  const app = await buildApp({ env, async resolveAuth(request) {
    if (request.url === '/mcp' && isMcpUnavailable()) throw new AppError('POLICY_VIOLATION', '테스트용 MCP 접근 차단', 403);
    return await local.resolveAuth?.(request) ?? null;
  }, async createIntegrationPlugins(deps) {
    search = vi.spyOn(deps.aggregatorService, 'searchCards');
    valuation = vi.spyOn(deps.valuationService, 'getValuation');
    return [...await createIntegrationPlugins(deps), ...await local.createIntegrationPlugins!(deps)];
  } });
  apps.push(app);
  await app.listen({ host: '127.0.0.1', port: 0 });
  const owner = { authorization: `Bearer ${createLocalAgentToken(secret)}` };
  const session = await app.inject({ method: 'POST', url: '/api/agent/sessions', headers: owner });
  const url = `/api/agent/sessions/${session.json().id}`;
  const send = (message: string) => app.inject({ method: 'POST', url: `${url}/messages`, headers: owner, payload: { message } });
  return { app, owner, url, send, search, valuation };
}

it('웹 세션의 검색과 적정가를 실제 MCP HTTP로 호출하고 스트리밍과 후보를 유지한다', async () => {
  const { app, owner, url, send, search, valuation: getValuation } = await setup();
  const mcpRequests: Array<{ method: string; authorization?: string }> = [];
  app.server.on('request', request => {
    if (request.url === '/mcp') mcpRequests.push({ method: request.method!, authorization: request.headers.authorization });
  });
  const choices = await send('choices');
  expect(choices.body).toContain('event: delta');
  expect(choices.body).toContain('event: completed');
  const history = (await app.inject({ url, headers: owner })).json().messages;
  expect(history[1].cardChoices[0].name).toBe('Pikachu');
  const valuation = await send('valuation');
  expect(valuation.body).toContain('event: completed');
  expect(valuation.body).toContain('MOCK');
  expect(search).toHaveBeenCalledTimes(2);
  expect(getValuation).toHaveBeenCalledExactlyOnceWith(history[1].cardChoices[0].id);
  expect(mcpRequests.filter(request => request.method === 'POST')).toHaveLength(5);
  expect(mcpRequests.every(request => request.authorization === undefined)).toBe(true);
  const count = mcpRequests.length;
  expect((await send('direct')).body).toContain('event: completed');
  expect(mcpRequests).toHaveLength(count);
});

it('MCP 연결 실패를 빈 검색이나 직접 서비스 호출로 대체하지 않고 같은 세션에서 재시도한다', async () => {
  let unavailable = true;
  const { app, owner, url, send, search } = await setup(() => unavailable);
  const failed = await send('choices');
  expect(failed.body).toContain('event: error');
  expect(failed.body).not.toContain('event: completed');
  expect(search).not.toHaveBeenCalled();
  expect((await app.inject({ url, headers: owner })).json().messages).toEqual([]);
  unavailable = false;
  expect((await send('choices')).body).toContain('event: completed');
  expect(search).toHaveBeenCalledTimes(1);
});
