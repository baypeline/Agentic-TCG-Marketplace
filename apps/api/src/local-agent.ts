import { getLocalAgentSecret, isLoopbackHost, readLocalAgentUserId } from '@tcg/config/local-agent-auth';
import type { ApiEnv } from '@tcg/config';
import { requireAuth, type AppOptions } from './app.js';

export function createLocalAgentOptions(env: ApiEnv, variables: NodeJS.ProcessEnv): Pick<AppOptions, 'resolveAuth' | 'createIntegrationPlugins'> {
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
    async createIntegrationPlugins(deps) {
      const { createAgentRuntime, createAgentSessionPlugin, createOpenAIDecisionApi } = await import('@tcg/agent');
      const runtime = createAgentRuntime({
        ...deps,
        model: variables.OPENAI_MODEL?.trim() || undefined,
        decisionApi: createOpenAIDecisionApi(variables.OPENAI_DECISION_MODEL?.trim() || undefined),
      });
      return [async host => {
        await host.register(createAgentSessionPlugin({ runtime, requireAuth }), { prefix: '/api' });
      }];
    },
  };
}
