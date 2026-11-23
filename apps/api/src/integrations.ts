import type { FastifyPluginAsync } from 'fastify';
import { createMcpPlugin } from '@tcg/mcp-server';
import type { IntegrationDependencies } from './app.js';

// 통합 순서는 Trading → Payment → MCP. 아직 Trading·Payment Plugin이 없어 MCP만 등록한다.
export async function createIntegrationPlugins({ aggregatorService, valuationService }: IntegrationDependencies): Promise<FastifyPluginAsync[]> {
  return [createMcpPlugin({ aggregatorService, valuationService, getAuth: request => request.auth })];
}
