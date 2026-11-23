import { createAggregatorService, createMockCardAdapter } from '@tcg/aggregator';
import { createMockPriceAdapter, createValuationService } from '@tcg/valuation';
import { connectMcpCardServices, createAgentRuntime, createOpenAIDecisionApi } from '../src/index.js';
import { loadOpenAIEnv } from './env.js';

loadOpenAIEnv();

function createMockCardServices() {
  const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
  const valuationService = createValuationService({
    aggregatorService,
    adapter: createMockPriceAdapter(),
  });
  return { aggregatorService, valuationService };
}

const url = process.env.AGENT_MCP_URL?.trim();
const token = process.env.AGENT_MCP_TOKEN?.trim();
const mcp = url ? await connectMcpCardServices({
  url,
  headers: token ? { Authorization: `Bearer ${token}` } : undefined,
}) : undefined;

try {
  const runtime = createAgentRuntime({
    ...(mcp ?? createMockCardServices()),
    model: process.env.OPENAI_MODEL?.trim() || undefined,
    decisionApi: createOpenAIDecisionApi(process.env.OPENAI_DECISION_MODEL?.trim() || undefined),
  });
  console.log(await runtime.runAgentTurn(process.argv.slice(2).join(' ') || '피카츄 적정가 알려줘'));
} finally {
  await mcp?.close();
}
