import { ProtocolError, ProtocolErrorCode, Server, type Tool } from '@modelcontextprotocol/server';
import { AppError } from '@tcg/contracts';
import { z } from 'zod';
import { INTERNAL_ERROR_MESSAGE, toolFailure, toolSuccess } from './result.js';
import type { ToolContext, ToolDefinition } from './tools.js';

export const SERVER_INFO = { name: 'tcg-marketplace', version: '0.1.0' };

export interface RequestScope extends ToolContext {
  requestId: string;
  logError(error: unknown, toolName: string): void;
}

// $schema는 빼서 다른 클라이언트의 스키마 변환과 부딪히지 않게 한다.
function toInputJsonSchema(schema: z.ZodObject): Tool['inputSchema'] {
  const { $schema: _dialect, ...json } = z.toJSONSchema(schema, { io: 'input' });
  return { ...json, type: 'object' } as Tool['inputSchema'];
}

// 요청마다 새로 만든다(무상태). 고수준 McpServer는 입력 오류를 SDK 형식으로 바꿔서 저수준 Server를 쓴다.
export function createMcpServer(tools: readonly ToolDefinition[], scope: RequestScope): Server {
  const server = new Server(SERVER_INFO, { capabilities: { tools: {} } });
  const toolsByName = new Map(tools.map(tool => [tool.name, tool]));

  server.setRequestHandler('tools/list', async () => ({
    tools: tools.map(tool => ({
      name: tool.name,
      description: tool.description,
      inputSchema: toInputJsonSchema(tool.inputSchema),
      annotations: tool.annotations,
    })),
  }));

  server.setRequestHandler('tools/call', async request => {
    const tool = toolsByName.get(request.params.name);
    if (!tool) throw new ProtocolError(ProtocolErrorCode.InvalidParams, `Tool ${request.params.name} not found`);
    try {
      const outcome = await tool.invoke(request.params.arguments ?? {}, { auth: scope.auth });
      if (outcome.kind === 'invalid') {
        return toolFailure(
          { code: 'VALIDATION_ERROR', message: `입력 형식을 확인하세요. ${outcome.issues}`, retryable: false },
          scope.requestId,
        );
      }
      return toolSuccess(outcome.data, scope.requestId);
    } catch (error) {
      if (error instanceof AppError) {
        return toolFailure({ code: error.code, message: error.message, retryable: error.retryable }, scope.requestId);
      }
      scope.logError(error, tool.name);
      return toolFailure({ code: 'INTERNAL_ERROR', message: INTERNAL_ERROR_MESSAGE, retryable: false }, scope.requestId);
    }
  });

  return server;
}
