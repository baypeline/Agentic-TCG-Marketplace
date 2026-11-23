import { describe, expect, it } from 'vitest';
import { toolFailure, toolSuccess } from '../src/result.js';

describe('도구 결과 형식', () => {
  it('성공은 structuredContent와 같은 JSON 텍스트를 담는다', () => {
    const result = toolSuccess({ items: [] }, 'req-1');
    expect(result.isError).toBeUndefined();
    expect(result.structuredContent).toEqual({ ok: true, data: { items: [] }, requestId: 'req-1' });
    expect(result.content).toEqual([{ type: 'text', text: JSON.stringify(result.structuredContent) }]);
  });

  it('업무 오류는 isError와 계약 오류 형식을 담는다', () => {
    const result = toolFailure({ code: 'CARD_NOT_FOUND', message: '카드를 찾을 수 없습니다.', retryable: false }, 'req-2');
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toEqual({
      ok: false,
      error: { code: 'CARD_NOT_FOUND', message: '카드를 찾을 수 없습니다.', retryable: false },
      requestId: 'req-2',
    });
    expect(JSON.parse((result.content[0] as { text: string }).text)).toEqual(result.structuredContent);
  });
});
