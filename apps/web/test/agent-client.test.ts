import { expect, it, vi } from 'vitest';
import { readAgentMessage, readAgentReply } from '../src/features/chat/agent-client';
import { demoCards } from '@tcg/contracts/fixtures';

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

it('완료 전 델타를 콜백으로 전달하고 완료 시 검증된 후보와 최종 문장을 반환한다', async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const input = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  const encode = (text: string) => new TextEncoder().encode(text);
  const onTextDelta = vi.fn();
  const task = readAgentMessage(input, { onTextDelta });
  controller.enqueue(encode('event: delta\r\ndata: {"delta":"피카츄"}\r\n\r\n'));
  await vi.waitFor(() => expect(onTextDelta).toHaveBeenCalledExactlyOnceWith('피카츄'));
  const message = { content: '피카츄를 찾았어요.', cardChoices: [demoCards[0]!] };
  controller.enqueue(encode(`event: completed\ndata: ${JSON.stringify({ message })}\n\n`));
  await expect(task).resolves.toEqual(message);
});

it('델타 뒤 끊긴 응답이나 오류를 완료로 오인하지 않는다', async () => {
  const onTextDelta = vi.fn();
  await expect(readAgentMessage(stream('event: delta\ndata: {"delta":"부분 출력"}\n\n'), { onTextDelta })).rejects.toThrow('답변을 받지 못했습니다');
  expect(onTextDelta).toHaveBeenCalledWith('부분 출력');
  await expect(readAgentMessage(stream('event: delta\ndata: {"delta":123}\n\n'))).rejects.toThrow();
});

it('여러 청크로 나뉜 SSE에서 최종 한국어 메시지를 읽는다', async () => {
  const content = '피카츄\n데모 가격 12 USDC';
  const input = stream(`event: started\ndata: {}\n\nevent: completed\ndata: ${JSON.stringify({ message: { content } })}\n\n`);
  await expect(readAgentReply(input)).resolves.toBe(content);
});

it('SSE 오류나 완료 이벤트 없이 끊긴 스트림을 실패로 처리한다', async () => {
  await expect(readAgentReply(stream('event: error\ndata: {"message":"조회 실패"}\n\n'))).rejects.toThrow('조회 실패');
  await expect(readAgentReply(stream('event: started\ndata: {}\n\n'))).rejects.toThrow('답변을 받지 못했습니다');
});

it('텍스트와 별도로 검증된 카드 후보를 읽고 잘못된 후보는 거부한다', async () => {
  const message = { content: '카드를 선택해 주세요.', cardChoices: [demoCards[0]!] };
  const completed = (value: unknown) => stream(`event: completed\ndata: ${JSON.stringify({ message: value })}\n\n`);
  await expect(readAgentMessage(completed(message))).resolves.toEqual(message);
  await expect(readAgentMessage(completed({ ...message, cardChoices: [{ name: '가짜 카드' }] }))).rejects.toThrow();
  await expect(readAgentMessage(completed({ ...message, cardChoices: [demoCards[0], demoCards[0]] }))).rejects.toThrow();
});
