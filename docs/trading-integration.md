# 트레이딩 엔진 1차 통합

이 가이드는 현재 실행 가능한 1차 코드의 동작을 설명합니다. 새 [합의 사항](decisions.md)은 기존 미제출 예약을 정책 변경·Agent 중단만으로 해제하지 않고 원래 TTL까지 결제를 보류하도록 정합니다. 코드의 즉시 예약 해제·SSE 중단 동작은 아직 변경 전입니다. 목표 계약은 [API 계약서 v2.1](api-contract.md)을 참고하세요.

Core API가 `@tcg/trading`의 REST Plugin을 `/api`에 등록합니다. 인벤토리·매물·지정가 주문·예약을 처리합니다. 정책·예산·서버 실행, MCP 거래 도구와 결제/체결 복구도 같은 저장소에 연결합니다. Web은 조회 패널을 연결했고 거래를 변경하는 기존 폼·채팅은 미리보기입니다.

## 로컬 실행

Node.js 24 LTS와 pnpm 12.9.1을 사용합니다. 루트 `.env`가 없다면 `pnpm env:init`을 실행하고 `pnpm install`을 실행합니다.

기본 `TRADING_DATA_SOURCE=mock`은 DB 없이 시연 재고 여섯 장을 사용합니다. 재시작하면 거래 상태가 초기화됩니다. 로컬 인증을 사용하려면 서로 다른 난수 토큰을 생성해 `.env`에 `DEMO_SELLER_TOKEN`, `DEMO_BUYER_TOKEN`으로 설정합니다. 각 토큰은 32자 이상이어야 합니다. 다음 명령을 두 번 실행해 생성할 수 있습니다.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64url'))"
```

데모 토큰은 신원만 인증합니다. 구매자로 `/api/policies`에 정책을 저장하고 `/sessions`에 policyId·instruction으로 서버 실행을 생성해야 예약할 수 있습니다. 토큰과 브라우저 연결 수를 online 상태로 취급하지 않습니다. 기본 호스트에는 실제 LLM 구매 실행기가 없으므로 생성된 RUNNING 실행은 거래 승인·상태 관리용입니다. 자연어 자동 실행은 `buildApp({ executeAgentRun })`에 실행기를 주입합니다.

데모 인증은 `NODE_ENV=development|test`, `API_HOST=127.0.0.1|::1|localhost`에서만 허용합니다. 두 토큰을 생략하면 보호된 거래 요청은 401입니다. 사용자·Agent ID 헤더와 요청 필드는 인증 수단이 아닙니다. 실제 인증은 `buildApp({ resolveAuth })`에 사용자·Agent 소유권을 검증하는 제공자를 주입합니다.

| 역할 | 고정 ID | 권한 |
| --- | --- | --- |
| 판매자 | `00000000-0000-4000-8002-000000000001` | 시연 재고 조회·매물 등록·취소 |
| 구매자 | `00000000-0000-4000-8002-000000000002` | 주문·예약 |
| 구매 Agent | `00000000-0000-4000-8002-000000000003` | 구매자 토큰에 연결 |

DB에 거래 상태를 보존하려면 `.env`를 다음처럼 설정합니다. `DATABASE_URL`은 `env:init`이 생성한 값을 사용합니다.

```dotenv
DATABASE_ENABLED=true
CARD_DATA_SOURCE=database
TRADING_DATA_SOURCE=database
TRADING_SWEEP_INTERVAL_MS=30000
```

```sh
pnpm infra:up
pnpm db:migrate
pnpm trading:seed
pnpm --filter @tcg/api dev
```

`trading:seed`는 공용 시연 카드·Mock 가격을 준비하고 판매자 재고 여섯 장을 추가합니다. 재실행해도 기존 재고 소유권과 매물·예약 상태를 초기화하지 않습니다. 실제 카드 수집 결과를 자동으로 사용자 재고로 등록하지 않습니다.

## REST 시연

아래 Bash 예시는 루트 `.env`에서 주소와 토큰을 읽습니다.

```sh
api_base=$(node --env-file=.env -p "'http://127.0.0.1:' + (process.env.API_PORT || 4000)")
seller_token=$(node --env-file=.env -p 'process.env.DEMO_SELLER_TOKEN')
buyer_token=$(node --env-file=.env -p 'process.env.DEMO_BUYER_TOKEN')

curl -sS "$api_base/health"
curl -sS "$api_base/api/inventory" -H "Authorization: Bearer $seller_token"
curl -sS -X POST "$api_base/api/listings" \
  -H "Authorization: Bearer $seller_token" -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-listing-1' \
  -d '{"inventoryItemId":"00000000-0000-4000-8003-000000000001","price":"10000000"}'
```

구매 정책을 먼저 만들고 반환된 id로 서버 실행을 생성합니다. 실제 UUID를 `<policy-id>`에 넣으세요.

```sh
curl -sS -X POST "$api_base/api/policies" \
  -H "Authorization: Bearer $buyer_token" -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-policy-1' \
  -d '{"enabled":true,"totalBudget":"30000000","maxPerTrade":"10000000","validUntil":"2026-12-01T00:00:00.000Z"}'
curl -sS -X POST "$api_base/sessions" \
  -H "Authorization: Bearer $buyer_token" -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-run-1' \
  -d '{"policyId":"<policy-id>","instruction":"구매 조건 확인"}'
```

매물 응답의 `id`를 다음 요청의 `<listing-id>`에 넣습니다. `10000000`은 10 USDC입니다. 예약 응답의 `id`는 `<quote-id>`에 넣습니다.

```sh
curl -sS "$api_base/api/listings"
curl -sS -X POST "$api_base/api/purchases/fixed/quote" \
  -H "Authorization: Bearer $buyer_token" -H 'Content-Type: application/json' -H 'Idempotency-Key: demo-quote-1' \
  -d '{"listingId":"<listing-id>","maxPrice":"10000000"}'
curl -sS -X DELETE "$api_base/api/quotes/<quote-id>" \
  -H "Authorization: Bearer $buyer_token"
```

예약 curl 예시는 위 정책과 실행이 유효할 때 실행합니다. 같은 요청을 재시도할 때는 같은 키를 유지하고 새로운 작업에는 새 키를 사용합니다.

전체 경로와 입력은 [Trading README](../packages/trading/README.md)를 참고하세요. REST는 DTO를 직접 반환하고 오류는 Core API 공통 형식을 사용합니다. 구매 요청에는 인증된 Agent가 필요합니다. 매칭은 명시적 요청으로 실행하며 자동 매칭 작업은 아직 없습니다.

## 예약과 결제 경계

예약 TTL은 2분입니다. 조회·매칭 시 정리와 별도로 Core API가 기본 30초마다 만료 `RESERVED`를 해제합니다. 작업이 실행 중이면 다음 주기를 건너뛰며, 종료 시 타이머와 실행 중 작업을 정리한 뒤 DB를 닫습니다. `PAYMENT_PENDING`과 미확정 결제는 TTL로 해제하지 않습니다.

`beginPayment`, `finalizeTrade`, `releaseFailedPayment`는 서버 내부 메서드이며 공개 REST로 제공하지 않습니다. 업무 Payment는 정책 검사·예산 예약·제출 버전·카드 보호를 같은 DB 트랜잭션에 기록하며 저수준 beginPayment를 단독 호출하지 않습니다. 거래 금액은 서버 MatchQuote에서 확정하고 0.01 테스트 USDC 도우미와 분리합니다.

## 결제·복구와 화면 조회

기본 `PAYMENT_ENABLED=false`는 실제 지급을 차단합니다. 테스트넷 어댑터를 연결하려면 DB 거래 설정에 `PAYMENT_ENABLED=true`, `PAYMENT_RECIPIENT`·`AGENT_WALLET_ADDRESS` 공개 주소를 추가합니다. 현재 server.ts는 데모 구매 Agent에만 이 지갑을 연결하며 임의 사용자의 지갑으로 취급하지 않습니다. 실제 사용자 호스트는 검증한 지갑 제공자를 주입해야 합니다. 개인키·서명 원문은 설정 예시나 로그에 넣지 않습니다.

MCP `execute_purchase`는 먼저 서버 x402 요구를 반환합니다. 서명기는 요구와 허용 정책을 확인한 뒤 동일 인수와 `_meta["x402/payment"]`로 재호출합니다. 서버 기본 진입점은 지급 서명을 생성하지 않습니다. 서버 실행기의 작업 키는 `policies.actionKey`와 `createServerMcpClient`로 영속 보관·재사용할 수 있습니다.

외부 정산 요청 전에 승인 DB 커밋을 끝냅니다. 이후 UNKNOWN은 Agent 중단·원래 TTL과 관계없이 카드/예산을 보호하며 기존 증빙만 조회합니다. 트랜잭션 해시가 없으면 운영 확인 대상으로 남깁니다. SETTLED 후 소유권 이전이 실패하면 예산은 사용 완료로 유지하고 거래만 재시도합니다. 기본 5분 지연부터 needsReview를 표시하며 시간을 이유로 재결제·강제 해제하지 않습니다.

Web `/agent`·`/activity`의 상태 패널은 로그인 쿠키 또는 로컬 `WEB_DEMO_ROLE=buyer|seller`로 조회합니다. 서버 토큰은 브라우저에 전달하지 않습니다. 기존 거래 변경 UI와 자연어 채팅은 미리보기이며 실제 정책 저장·실행·결제를 수행하지 않습니다.

## 검증

```sh
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
```

`test:db`는 루트 `.env`의 `DATABASE_TEST_URL` 또는 `DATABASE_URL`에 전체 DB 통합 테스트를 실행합니다. Migration을 적용한 전용 테스트 DB를 권장합니다. 동시 매물 등록·예약·멱등 체결, REST 인증·소유권, 재시작 영속성, 조회 없는 예약 만료 해제를 검증합니다. 서버 실행의 SSE 연결 종료, 정책 변경과 제출 순서, 동시 예산 예약, UNKNOWN·체결 복구 및 MCP 지급 메타데이터도 테스트합니다. 실제 LLM/Facilitator 네트워크 호출이나 Web 쓰기 E2E는 포함하지 않습니다.
