import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, validateOriginHeader } from '@modelcontextprotocol/server';
import type { AggregatorService, AuthContext, ValuationService } from '@tcg/contracts';
import { createMcpServer } from './server.js';
import { createTools } from './tools.js';

export const MCP_PATH = '/mcp';

export interface McpPluginDependencies {
  aggregatorService: AggregatorService;
  valuationService: ValuationService;
  /** 호스트가 검증한 인증 정보를 꺼내는 함수. 기본값은 인증 없음. */
  getAuth?: (request: FastifyRequest) => AuthContext | null;
  /** 허용할 브라우저 Origin의 호스트 이름(포트 무관). 기본값은 빈 목록이라 Origin 헤더가 붙은 요청을 모두 거절한다. */
  allowedOrigins?: readonly string[];
}

function rejectOrigin(reply: FastifyReply) {
  return reply
    .code(403)
    .type('application/json')
    .send({ jsonrpc: '2.0', error: { code: -32000, message: 'Origin not allowed.' }, id: null });
}

export function createMcpPlugin({
  aggregatorService,
  valuationService,
  getAuth = () => null,
  allowedOrigins = [],
}: McpPluginDependencies): FastifyPluginAsync {
  const tools = createTools({ aggregatorService, valuationService });

  return async app => {
    // 본문은 SDK가 직접 읽는다. 깨진 JSON(400, -32700), 지원하지 않는 형식(415), 큰 본문(413)을 MCP 규칙대로 답한다.
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', (_request, _payload, done) => { done(null); });

    // DNS rebinding 방지. 서버 간 호출에는 Origin 헤더가 없다.
    // 헤더가 아예 없을 때만 통과시킨다. SDK 검사는 빈 값을 통과시키므로 먼저 거절한다.
    app.addHook('onRequest', async (request, reply) => {
      const { origin } = request.headers;
      if (origin === undefined) return;
      if (origin === '' || allowedOrigins.length === 0 || !validateOriginHeader(origin, [...allowedOrigins]).ok) {
        return rejectOrigin(reply);
      }
    });

    app.route({
      method: ['GET', 'POST', 'DELETE'],
      url: MCP_PATH,
      handler: async (request, reply) => {
        const scope = {
          auth: getAuth(request),
          requestId: request.id,
          logError: (error: unknown, toolName: string) =>
            request.log.error({ err: error, toolName }, 'MCP 도구 실행 중 예외가 발생했습니다.'),
        };
        // 요청마다 핸들러를 만들어 인증 정보와 요청 ID가 다른 요청과 섞이지 않게 한다.
        const handler = createMcpHandler(() => createMcpServer(tools, scope), {
          onerror: error => request.log.warn({ err: error }, 'MCP 요청을 처리하지 못했습니다.'),
        });
        reply.hijack();
        await toNodeHandler(handler)(request.raw, reply.raw);
      },
    });
  };
}
