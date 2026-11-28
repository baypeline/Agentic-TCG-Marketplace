import { getLocalAgentSecret, isLoopbackHost, readLocalAgentUserId } from '@tcg/config/local-agent-auth';
import type { ApiEnv } from '@tcg/config';
import type { AgentSessionPluginOptions } from '@tcg/agent';
import { requireAuth, type AppOptions } from './app.js';

export function createLocalAgentOptions(env: ApiEnv, variables: NodeJS.ProcessEnv, options: { purchase?: AgentSessionPluginOptions['purchase'] } = {}): Pick<AppOptions, 'resolveAuth' | 'createIntegrationPlugins'> {
  const secret = getLocalAgentSecret(env.NODE_ENV, variables.AGENT_LOCAL_SECRET);
  if (!secret || !isLoopbackHost(env.API_HOST) || !variables.OPENAI_API_KEY?.trim()) return {};

  return {
    async resolveAuth(request) {
      const route = request.routeOptions.url;
      if (route !== '/api/agent/sessions' && !route?.startsWith('/api/agent/sessions/')) return null;
      const header = request.headers.authorization;
      const userId = header?.startsWith('Bearer ') ? readLocalAgentUserId(header.slice(7), secret) : undefined;
      return userId ? { userId } : null;
    },
    async createIntegrationPlugins() {
      const { createAgentRuntime, createAgentSessionPlugin, createOpenAIDecisionApi, connectMcpCardServices } = await import('@tcg/agent');
      const decisionApi = createOpenAIDecisionApi(variables.OPENAI_DECISION_MODEL?.trim() || undefined, { marketplaceEnabled: env.DEMO_SCENARIOS_ENABLED });
      return [async host => {
        const runtime = {
          async runAgentTurn(message: string, options?: import('@tcg/agent').AgentTurnOptions) {
            let connection: ReturnType<typeof connectMcpCardServices> | undefined;
            const connect = () => {
              // listen 이후 실제 바인딩 주소를 사용한다. 카드 도구를 쓰지 않는 턴은 연결하지 않는다.
              if (!connection) {
                const address = host.server.address();
                if (!address || typeof address === 'string') throw new Error('카드 MCP 서버가 수신 중이 아닙니다.');
                const hostname = address.family === 'IPv6' ? `[${address.address}]` : address.address;
                connection = connectMcpCardServices({ url: `http://${hostname}:${address.port}/mcp`, signal: options?.signal });
              }
              return connection;
            };
            const agent = createAgentRuntime({
              model: variables.OPENAI_MODEL?.trim() || undefined,
              decisionApi,
              aggregatorService: { async searchCards(input) { return (await connect()).aggregatorService.searchCards(input); } },
              valuationService: { async getValuation(id) { return (await connect()).valuationService.getValuation(id); } },
              ...(env.DEMO_SCENARIOS_ENABLED ? { marketplaceService: { paymentReady: env.PAYMENT_ENABLED, paymentChain: env.PAYMENT_CHAIN, signingMode: env.AGENT_SIGNING_MODE, async listListings(id: string) { return (await connect()).listListings(id); } } } : {}),
            });
            try { return await agent.runAgentTurn(message, options); }
            finally {
              // 조회 연결의 정리 실패로 성공한 답변을 오류로 바꾸지 않는다.
              if (connection) await connection.then(client => client.close()).catch(error => host.log.warn({ err: error }, 'Card MCP connection cleanup failed'));
            }
          },
        };
        await host.register(createAgentSessionPlugin({ runtime, requireAuth, ...(env.DEMO_SCENARIOS_ENABLED && options.purchase ? { purchase: options.purchase } : {}) }), { prefix: '/api' });
      }];
    },
  };
}
