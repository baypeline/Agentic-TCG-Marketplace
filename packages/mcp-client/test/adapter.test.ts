import type { CallToolResult } from '@openai/agents';
import { demoCards } from '@tcg/contracts/fixtures';
import { describe, expect, it, vi } from 'vitest';
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
