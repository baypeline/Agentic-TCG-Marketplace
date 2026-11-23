import type { CallToolResult } from '@modelcontextprotocol/server';
import type { ErrorCode } from '@tcg/contracts';

export interface ToolErrorBody {
  code: ErrorCode;
  message: string;
  retryable: boolean;
}

// REST 오류 응답과 같은 문구. 원인은 서버 로그에만 남긴다.
export const INTERNAL_ERROR_MESSAGE = '서버 처리 중 오류가 발생했습니다.';

// structuredContent를 읽지 않는 클라이언트도 쓸 수 있게 같은 객체를 JSON 텍스트로도 담는다.
function toCallToolResult(body: Record<string, unknown>, isError: boolean): CallToolResult {
  const result: CallToolResult = {
    content: [{ type: 'text', text: JSON.stringify(body) }],
    structuredContent: body,
  };
  if (isError) result.isError = true;
  return result;
}

export function toolSuccess(data: unknown, requestId: string): CallToolResult {
  return toCallToolResult({ ok: true, data, requestId }, false);
}

export function toolFailure(error: ToolErrorBody, requestId: string): CallToolResult {
  return toCallToolResult({ ok: false, error, requestId }, true);
}
