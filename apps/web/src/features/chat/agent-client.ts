import { agentChatReplySchema, agentTextDeltaSchema, type AgentChatReply } from '@tcg/contracts';

export type AgentReply = AgentChatReply;

export async function readAgentMessage(stream: ReadableStream<Uint8Array>, options: { onTextDelta?: (delta: string) => void } = {}): Promise<AgentReply> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      buffer = buffer.replace(/\r\n/g, '\n');
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const lines = frame.split('\n');
        const event = lines.find(line => line.startsWith('event:'))?.slice(6).trim();
        const data = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
        if (data) {
          if (event === 'error') {
            const payload = JSON.parse(data);
            throw new Error(payload.message || '에이전트 답변을 받지 못했습니다.');
          }
          if (event === 'delta') {
            options.onTextDelta?.(agentTextDeltaSchema.parse(JSON.parse(data)).delta);
          }
          if (event === 'completed') {
            const payload = JSON.parse(data);
            return agentChatReplySchema.parse(payload.message);
          }
        }
        end = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    throw new Error('에이전트 답변을 받지 못했습니다.');
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// 기존 문자열 응답 소비자와의 호환성을 유지한다.
export async function readAgentReply(stream: ReadableStream<Uint8Array>): Promise<string> {
  return (await readAgentMessage(stream)).content;
}
