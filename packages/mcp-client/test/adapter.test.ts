import { createServer } from 'node:http';
import { once } from 'node:events';
import type { CallToolResult } from '@openai/agents';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { demoCards } from '@tcg/contracts/fixtures';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createMcpClientAdapter, McpResponseError, McpToolError } from '../src/index.js';

const success = { ok: true, data: { items: [demoCards[0]!], nextCursor: null }, requestId: 'request-1' };
const failure = { ok: false, error: { code: 'CARD_NOT_FOUND', message: '카드를 찾을 수 없습니다.', retryable: false } };
const text = (payload: unknown) => ({ type: 'text' as const, text: JSON.stringify(payload) });

function read(result: CallToolResult) {
  const adapter = createMcpClientAdapter({ url: 'http://localhost/mcp' });
  vi.spyOn(adapter.server, 'callToolResult').mockResolvedValue(result);
  return adapter.callTool('search_cards', {});
}

describe('도구 응답 계약', () => {
  it('structuredContent를 먼저 읽고, 해당 필드가 없으면 단일 JSON 텍스트를 읽는다', async () => {
    await expect(read({ structuredContent: success, content: [text(failure)] })).resolves.toEqual(success.data);
    await expect(read({ content: [text(success)] })).resolves.toEqual(success.data);
    await expect(read({ content: [text({ ...success, data: null })] })).resolves.toBeNull();
  });

  it('업무 오류에서 코드와 재시도 여부를 보존하고 요청 ID가 없는 오류 예시도 처리한다', async () => {
    const payload = { ...failure, requestId: 'request-2' };
    await expect(read({ isError: true, content: [], structuredContent: payload })).rejects.toMatchObject({
      name: 'McpToolError', code: 'CARD_NOT_FOUND', message: failure.error.message, retryable: false, requestId: 'request-2',
    });
    await expect(read({ isError: true, content: [text(failure)] })).rejects.toBeInstanceOf(McpToolError);
    await expect(read({ content: [text({ ...failure, error: { ...failure.error, retryable: true } })] }))
      .rejects.toMatchObject({ retryable: true });
  });

  it('잘못된 구조화 결과를 텍스트로 덮어쓰거나 실패 결과를 성공으로 돌려주지 않는다', async () => {
    const invalid: CallToolResult[] = [
      { structuredContent: {}, content: [text(success)] },
      { isError: true, structuredContent: success, content: [] },
      { content: [text({ ok: true, data: {} })] },
      { content: [text({ ok: true, requestId: 'request-1' })] },
      { content: [text(success), text(success)] },
      { content: [{ type: 'text', text: 'invalid JSON' }] },
      { content: [] },
    ];
    for (const result of invalid) await expect(read(result)).rejects.toBeInstanceOf(McpResponseError);
  });

  it('HTTP와 HTTPS 이외의 엔드포인트를 거절한다', () => {
    expect(() => createMcpClientAdapter({ url: 'file:///mcp' })).toThrow();
  });
});

it('Streamable HTTP로 도구 목록과 검색을 호출하고 설정한 인증 헤더를 보낸다', async () => {
  const calls: Array<{ query: string; limit: number }> = [];
  const headers: Array<{ authorization?: string; origin?: string }> = [];
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: 'catalog-fixture', version: '1' });
    mcp.registerTool('search_cards', {
      description: '카드 검색', inputSchema: z.object({ query: z.string(), limit: z.number().int() }),
    }, async args => {
      calls.push(args);
      return { content: [text(success)], structuredContent: success };
    });
    mcp.registerTool('get_valuation', {
      inputSchema: z.object({ cardVariantId: z.uuid() }),
    }, async () => {
      const payload = { ...failure, requestId: 'request-2' };
      return { isError: true, content: [text(payload)], structuredContent: payload };
    });
    return mcp;
  });
  const serve = toNodeHandler(handler);
  const http = createServer((req, res) => {
    headers.push({ authorization: req.headers.authorization, origin: req.headers.origin });
    return serve(req, res);
  });
  http.listen(0, '127.0.0.1');
  await once(http, 'listening');
  try {
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('테스트 서버 주소가 없습니다.');
    const adapter = createMcpClientAdapter({
      url: `http://127.0.0.1:${address.port}/mcp`, name: 'catalog', headers: { Authorization: 'Bearer test-only' },
    });
    try {
      await adapter.connect();
      expect(await adapter.listTools()).toMatchObject([
        { name: 'search_cards', inputSchema: { type: 'object' } }, { name: 'get_valuation' },
      ]);
      const args = { query: 'Pikachu', limit: 10 };
      expect(await adapter.callTool('search_cards', args)).toEqual(success.data);
      expect(calls).toEqual([args]);
      await expect(adapter.callTool('get_valuation', { cardVariantId: '00000000-0000-4000-8000-000000000099' }))
        .rejects.toMatchObject({ name: 'McpToolError', code: 'CARD_NOT_FOUND', requestId: 'request-2' });
      await expect(adapter.callTool('unknown', {})).rejects.toMatchObject({ code: -32602 });
      expect(headers.length).toBeGreaterThan(0);
      for (const header of headers) expect(header).toEqual({ authorization: 'Bearer test-only', origin: undefined });
    } finally {
      await adapter.close();
    }
  } finally {
    await handler.close();
    await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
  }
});
