import { MCPServerStreamableHttp, type CallToolResult } from '@openai/agents';
import { errorResponseSchema, type ErrorCode } from '@tcg/contracts';
import { z } from 'zod';

const endpointSchema = z.url({ protocol: /^https?$/ });
const requestIdSchema = z.string().min(1);
const resultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), data: z.json(), requestId: requestIdSchema }),
  z.object({ ok: z.literal(false), error: errorResponseSchema.shape.error, requestId: requestIdSchema.optional() }),
]);

export interface McpClientAdapterConfig {
  url: string;
  headers?: Record<string, string>;
  name?: string;
}

export interface AgentMcpAdapter {
  readonly server: MCPServerStreamableHttp;
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools: MCPServerStreamableHttp['listTools'];
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export class McpToolError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(error: z.infer<typeof errorResponseSchema.shape.error>, requestId?: string) {
    super(error.message);
    this.name = 'McpToolError';
    this.code = error.code;
    this.retryable = error.retryable;
    this.requestId = requestId;
  }
}

export class McpResponseError extends Error {
  constructor(tool: string) {
    super(`MCP 도구 응답이 팀 계약과 일치하지 않습니다: ${tool}`);
    this.name = 'McpResponseError';
  }
}

function readToolData(name: string, result: CallToolResult): unknown {
  let payload: unknown = result.structuredContent;
  if (payload === undefined) {
    const [block] = result.content;
    if (result.content.length !== 1 || block?.type !== 'text' || typeof block.text !== 'string') {
      throw new McpResponseError(name);
    }
    try {
      payload = JSON.parse(block.text);
    } catch {
      throw new McpResponseError(name);
    }
  }
  const parsed = resultSchema.safeParse(payload);
  if (!parsed.success) throw new McpResponseError(name);
  const envelope = parsed.data;
  if (!envelope.ok) throw new McpToolError(envelope.error, envelope.requestId);
  if (result.isError) throw new McpResponseError(name);
  return envelope.data;
}

export function createMcpClientAdapter({ url, headers, name }: McpClientAdapterConfig): AgentMcpAdapter {
  const server = new MCPServerStreamableHttp({
    url: endpointSchema.parse(url),
    name,
    requestInit: { headers },
  });
  return {
    server,
    connect: () => server.connect(),
    close: () => server.close(),
    listTools: () => server.listTools(),
    async callTool(tool, args) {
      return readToolData(tool, await server.callToolResult(tool, args));
    },
  };
}
