import { expect, it } from 'vitest';
import { readAgentReply } from '../src/features/chat/agent-client';

function stream(text: string, chunkSize = 7) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        controller.enqueue(bytes.slice(offset, offset + chunkSize));
      }
      controller.close();
    },
  });
}

it('여러 청크로 나뉜 SSE에서 최종 한국어 메시지를 읽는다', async () => {
  const content = '피카츄\n데모 가격 12 USDC';
  const input = stream(`event: started\ndata: {}\n\nevent: completed\ndata: ${JSON.stringify({ message: { content } })}\n\n`);
  await expect(readAgentReply(input)).resolves.toBe(content);
});

it('SSE 오류나 완료 이벤트 없이 끊긴 스트림을 실패로 처리한다', async () => {
  await expect(readAgentReply(stream('event: error\ndata: {"message":"조회 실패"}\n\n'))).rejects.toThrow('조회 실패');
  await expect(readAgentReply(stream('event: started\ndata: {}\n\n'))).rejects.toThrow('답변을 받지 못했습니다');
});
