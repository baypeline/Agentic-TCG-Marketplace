# MCP Client

김민지 담당. `createMcpClientAdapter`는 OpenAI Agents SDK의 Streamable HTTP 클라이언트를 사용한다. 도구 목록을 조회하고 팀 MCP 결과에서 `data`를 꺼낸다.

## 카드 검색

MCP 서버가 실행 중인 URL을 넘긴다. 아래 주소는 Core API의 기본 포트를 쓸 때의 예시다. 인증 헤더가 필요한 호스트는 `headers`에 전달한다.

```ts
import { cardSearchResponseSchema } from '@tcg/contracts';
import { createMcpClientAdapter } from '@tcg/mcp-client';

const adapter = createMcpClientAdapter({ url: 'http://127.0.0.1:4000/mcp' });
try {
  await adapter.connect();
  const tools = await adapter.listTools();
  console.log(tools.map(tool => tool.name));
  const data = await adapter.callTool('search_cards', { query: 'Pikachu', limit: 10 });
  const { items } = cardSearchResponseSchema.parse(data);
  console.log(items.map(card => card.name));
} finally {
  await adapter.close();
}
```

## 응답과 오류

| 응답 | 어댑터 동작 | 호출자가 확인할 값 |
| --- | --- | --- |
| 성공 | `{ ok: true, data, requestId }`에서 `data` 반환 | 도구별 DTO를 공통 Zod 스키마로 검증 |
| 업무 오류 | `McpToolError` 발생 | `code`, `message`, `retryable`, 서버가 제공한 `requestId` |
| 계약과 다른 결과 | `McpResponseError` 발생 | 호출한 도구 이름 |
| 연결 실패 또는 JSON-RPC 오류 | SDK가 발생시킨 오류 전달 | 연결 상태 또는 프로토콜 오류 코드 |

어댑터는 `structuredContent`를 먼저 검사한다. 해당 필드를 생략한 서버에서는 단일 `content` 텍스트 블록의 JSON을 읽는다. SDK 서버 객체가 필요한 호출자는 `adapter.server`를 사용한다. 기존 Agent의 의도별 도구 선택과 현재 턴의 카드 ID 검증은 `apps/agent`가 맡는다. x402 서명 요청과 결제 재호출은 후속 범위다.

## 독립 검증

저장소 루트에서 Node 24와 pnpm 12.9.1을 사용한다. 네트워크 테스트는 로컬 임의 포트에 SDK 테스트 서버를 띄운다. OpenAI API 키와 DB 연결은 필요 없다.

```sh
pnpm install --frozen-lockfile
pnpm --filter @tcg/mcp-client typecheck
pnpm --filter @tcg/mcp-client test
pnpm --filter @tcg/mcp-client build
```
