import { randomUUID } from 'node:crypto';

/** 서버 실행 계층 전용. keyFor는 실행 ID·작업 이름·인수를 영속 저장한다. */
export function createServerMcpClient({ url, headers, keyFor }: {
  url: string;
  headers?: Record<string, string>;
  keyFor: (action: string, input: unknown) => Promise<string>;
}) {
  return {
    async call(name: string, args: Record<string, unknown>, action: string, paymentPayload?: unknown) {
      const key = await keyFor(action, { name, args });
      const body = JSON.stringify({ jsonrpc: '2.0', id: randomUUID(), method: 'tools/call', params: { name, arguments: args, ...(paymentPayload === undefined ? {} : { _meta: { 'x402/payment': paymentPayload } }) } });
      let last: unknown;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const response = await fetch(url, { method: 'POST', headers: { ...headers, 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'idempotency-key': key }, body, signal: AbortSignal.timeout(30_000) });
          if (!response.ok) throw new Error(`MCP HTTP ${response.status}`);
          const text = await response.text();
          const event = text.split('\n').find(line => line.startsWith('data: '));
          const envelope = JSON.parse(event ? event.slice(6) : text) as { result?: { isError?: boolean; structuredContent?: Record<string, unknown>; content?: { type: string; text?: string }[]; _meta?: Record<string, unknown> }; error?: unknown };
          if (!envelope.result || envelope.error) throw new Error('MCP 호출 결과가 없습니다.');
          return envelope.result;
        } catch (error) { last = error; }
      }
      throw last;
    },
  };
}
