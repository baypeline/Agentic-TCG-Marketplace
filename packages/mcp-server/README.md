# MCP Server

담당: 김민지

Core API(Fastify) 안에서 MCP Streamable HTTP 엔드포인트 `/mcp`를 제공하는 플러그인. 독립 `listen()`은 호출하지 않음.

## 사용

```ts
import { createMcpPlugin } from '@tcg/mcp-server';

await app.register(createMcpPlugin({
  aggregatorService,
  valuationService,
  getAuth: request => request.auth, // 호스트가 검증한 인증 정보
}));
```

- Core API는 `apps/api/src/integrations.ts`에서 등록함. `server.ts`와 테스트가 같은 함수를 씀
- Agent는 `AGENT_MCP_URL=http://127.0.0.1:<API_PORT>/mcp`로 연결함

## 도구

| 도구 | 입력 | 성공 시 `data` |
|---|---|---|
| `search_cards` | `query` 문자열(앞뒤 공백 제거, 최대 200자, 기본 `''`), `limit` 정수(1~100, 기본 20) | `{ items: CardVariant[], nextCursor: null }` |
| `get_valuation` | `cardVariantId` UUID | `Valuation` |

- 입력 규칙은 REST `GET /api/cards`와 같음. 정의하지 않은 인수(`agentId` 등)는 입력 오류
- 두 도구 모두 조회 전용(`readOnlyHint: true`)

## 결과 형식

| 경우 | `structuredContent` | `isError` |
|---|---|---|
| 성공 | `{ ok: true, data, requestId }` | 없음 |
| 업무 오류 | `{ ok: false, error: { code, message, retryable }, requestId }` | `true` |

- `content`에도 같은 객체를 JSON 텍스트 한 개로 담음
- `requestId`는 Fastify 요청 ID. REST 오류 응답과 같은 값임

## 오류

| 상황 | 결과 |
|---|---|
| 입력이 스키마와 다름 | `VALIDATION_ERROR`, message에 필드 경로 |
| 서비스가 던진 `AppError` | code, message, retryable 그대로 (예: 없는 카드는 `CARD_NOT_FOUND`) |
| 그 밖의 예외, 서비스 출력 검증 실패 | `INTERNAL_ERROR`, 고정 메시지. 원인은 서버 로그에만 남김 |
| 없는 도구 | JSON-RPC 오류 `-32602` |
| 깨진 JSON, 지원하지 않는 Content-Type | SDK가 400(`-32700`), 415로 답함 |

## HTTP와 보안

- SDK 공식 `createMcpHandler` + `toNodeHandler` 사용. 2026-07-28 방식과 2025 방식(`initialize`)을 모두 받음
- 무상태: 요청마다 새 서버를 만들고 세션 ID는 없음. 2025 방식 응답은 SSE 한 건, GET/DELETE는 405
- 본문은 SDK가 직접 읽음. 플러그인 범위에서 Fastify 본문 파서를 끔
- `allowedOrigins`(호스트 이름)에 없는 `Origin`은 403. 기본값은 빈 목록이라 브라우저 요청은 모두 거절하고, Origin 없는 서버 간 호출은 통과
- 카드 조회 도구는 인증 없이 호출 가능. 사용자/Agent ID는 도구 인수나 헤더에서 읽지 않음

## 확인

```bash
curl -s -X POST http://127.0.0.1:<API_PORT>/mcp \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

pnpm --filter @tcg/mcp-server test
pnpm --filter @tcg/mcp-server typecheck
```

- 테스트 16개: 도구 동작(메모리 전송), HTTP 동작(`inject`), 실제 포트에서 SDK 클라이언트와 `apps/agent`의 `connectMcpCardServices` 호환

## 1차 범위 밖

| 항목 | 필요한 것 |
|---|---|
| Trading 도구(`list_listings`, `get_listing`, 주문/구매 도구) | TradingService 조회 함수와 입출력 계약 (이채영) |
| 도구별 인증 요구, 승인되지 않은 호출 차단 | Core API 인증 provider (정연한) |
| x402 결제 요구와 재호출 | PaymentService `preparePayment`/`processSignedPayment` 계약 (최승원) |
| Host 헤더 검사 | 1차는 도구 호출이 POST뿐이고 브라우저 POST에는 항상 Origin이 붙어서 Origin 검사로 대신함 |
