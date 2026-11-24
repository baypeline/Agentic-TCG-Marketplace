import { MCPServerStreamableHttp } from '@openai/agents';
import { cardSearchResponseSchema, valuationSchema } from '@tcg/contracts';
import { z } from 'zod';
import type { CardToolDependencies } from './tools.js';

export interface McpCardConnectionOptions {
  url: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const searchResultSchema = z.object({ ok: z.literal(true), data: cardSearchResponseSchema });
const valuationResultSchema = z.object({ ok: z.literal(true), data: valuationSchema });

export async function connectMcpCardServices({ url, headers, signal, timeoutMs = 10_000 }: McpCardConnectionOptions) {
  const endpoint = z.url({ protocol: /^https?$/ }).parse(url);
  z.number().int().positive().parse(timeoutMs);
  signal?.throwIfAborted();
  const server = new MCPServerStreamableHttp({
    url: endpoint, requestInit: { headers },
    timeout: timeoutMs, clientSessionTimeoutSeconds: timeoutMs / 1000,
    fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, {
      ...init,
      signal: AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(signal ? [signal] : []), ...(init?.signal ? [init.signal] : [])]),
    }),
  });
  try {
    await server.connect();
  } catch (error) {
    await server.close().catch(() => undefined);
    throw error;
  }

  async function callCardTool(name: 'search_cards' | 'get_valuation', args: Record<string, unknown>) {
    signal?.throwIfAborted();
    const result = await server.callToolResult(name, args, undefined, { signal });
    if (result.isError) throw new Error(`MCP 도구 호출에 실패했습니다: ${name}`);
    if (result.structuredContent !== undefined) return result.structuredContent;

    // 서버가 구조화 출력을 지원하지 않을 때 단일 JSON 텍스트 응답을 읽는다.
    const [content] = result.content;
    if (result.content.length === 1 && content?.type === 'text' && typeof content.text === 'string') {
      return JSON.parse(content.text) as unknown;
    }
    throw new Error(`MCP 도구 응답에 카드 데이터가 없습니다: ${name}`);
  }

  const services: CardToolDependencies = {
    aggregatorService: {
      async searchCards(input) {
        const result = searchResultSchema.parse(await callCardTool('search_cards', input));
        return result.data.items;
      },
    },
    valuationService: {
      async getValuation(cardVariantId) {
        const result = valuationResultSchema.parse(await callCardTool('get_valuation', { cardVariantId }));
        if (result.data.cardVariantId !== cardVariantId) {
          throw new Error('MCP 적정가 응답의 카드 ID가 요청과 일치하지 않습니다.');
        }
        return result.data;
      },
    },
  };

  return { ...services, close: () => server.close() };
}
