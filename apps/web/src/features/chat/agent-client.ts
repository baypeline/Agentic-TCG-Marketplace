import { agentChatReplySchema, type AgentChatReply } from '@tcg/contracts';

export type AgentReply = AgentChatReply;

export async function readAgentMessage(stream: ReadableStream<Uint8Array>): Promise<AgentReply> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let reply: AgentReply | undefined;
  try {
    while (true) {
      const { done, value } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let end = buffer.indexOf('\n\n');
      while (end !== -1) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        const [event, data] = frame.split('\n');
        if (data?.startsWith('data: ')) {
          if (event === 'event: error') {
            const payload = JSON.parse(data.slice(6));
            throw new Error(payload.message || '에이전트 답변을 받지 못했습니다.');
          }
          if (event === 'event: completed') {
            const payload = JSON.parse(data.slice(6));
            reply = agentChatReplySchema.parse(payload.message);
          }
        }
        end = buffer.indexOf('\n\n');
      }
      if (done) break;
    }
    if (!reply) throw new Error('에이전트 답변을 받지 못했습니다.');
    return reply;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

// 기존 문자열 응답 소비자와의 호환성을 유지한다.
export async function readAgentReply(stream: ReadableStream<Uint8Array>): Promise<string> {
  return (await readAgentMessage(stream)).content;
}
