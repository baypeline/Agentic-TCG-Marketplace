# MCP Server

담당: 김민지

Core API(Fastify) 안에서 MCP Streamable HTTP 엔드포인트 `/mcp`를 제공하는 플러그인. 독립 `listen()`은 호출하지 않음.

## 사용

```ts
import { createMcpPlugin } from '@tcg/mcp-server';

await app.register(createMcpPlugin({
  aggregatorService,
  valuationService,
  tradingService,
  paymentService,
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
- 두 카드 도구는 조회 전용(`readOnlyHint: true`). Trading 주입 시 매물·주문·예약·결제 상태·결제 실행 도구 10개를 추가합니다. 전체 이름·입출력은 [API 계약서](../../docs/api-contract.md#4-mcp-tool-계약)를 따릅니다. 생성·매칭의 Idempotency-Key는 HTTP 헤더로 받으며 도구 인수로 키를 생성하지 않습니다.

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
- `allowedOrigins`(호스트 이름)에 없는 `Origin`은 403. 기본값은 빈 목록이라 `Origin`이 붙은 요청은 모두 거절함. 값이 빈 `Origin`도 403이고, 헤더가 없는 서버 간 호출만 통과
- 배포 전제: Core API 기본 바인딩은 루프백(`API_HOST=127.0.0.1`). 루프백 밖에 노출하면 플러그인이나 앞단 프록시에서 허용 Host를 검증해야 함
- 카드 조회 도구는 인증 없이 호출 가능. 사용자/Agent ID는 도구 인수나 헤더에서 읽지 않음

## 확인

저장소 루트에서 실행함. `.env`가 없으면 기본 포트 4000을 씀.

```bash
api_port=$(node --env-file-if-exists=.env -p 'process.env.API_PORT || 4000')
curl -sS -X POST "http://127.0.0.1:${api_port}/mcp" \
  -H 'Content-Type: application/json' \
  -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'

pnpm --filter @tcg/mcp-server test
pnpm --filter @tcg/mcp-server typecheck
```

- 테스트 17개: 도구 동작(메모리 전송), HTTP 동작(`inject`, 본문 4MiB 경계 포함), 실제 포트에서 SDK 클라이언트와 `apps/agent`의 `connectMcpCardServices` 호환

## x402 전송과 통합 범위

`execute_purchase`의 결제 요구는 직접 PaymentRequired 객체를 structuredContent와 JSON content에 반환하며 isError는 true입니다. 서버 실행 계층은 동일 인수와 `params._meta["x402/payment"]`로 서명 재호출합니다. 정산 성공은 `_meta["x402/payment-response"]`에 추가합니다. UNKNOWN·이미 제출한 시도는 상태만 반환하며 새 지급하지 않습니다. 일반 성공/업무 오류 래퍼와 구분합니다.

Core API 통합 테스트에서 정책·실행 생성→예약→MCP challenge→서명 재호출→소유권 이전·수익 집계를 검증합니다. 결제 어댑터는 테스트 대역이며 실제 테스트넷 지급 증빙은 별도입니다. 실제 인증 provider와 배포 Host 검증은 호스트 설정이 필요합니다.
