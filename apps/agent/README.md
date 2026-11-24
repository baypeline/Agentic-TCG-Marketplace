# Agent Runtime

서버 실행 `/sessions`와 기존 메모리 대화 플러그인을 구분합니다. 두 경로 모두 조회 SSE 종료로 서버 작업을 중단하지 않습니다. 명시적 중단은 미제출 예약을 유지·보류하고 제출된 결제 복구는 계속합니다.

담당: 최재민

`createAgentRuntime({ aggregatorService, valuationService, model, decisionApi })`로 런타임을 생성합니다. `runAgentTurn(message)`는 Decision API로 의도를 분류한 뒤 독립된 한 턴의 최종 응답을 반환합니다. 기본 분류기는 OpenAI Responses API 구조화 출력을 사용하며, 같은 `DecisionApi` 인터페이스의 구현을 주입할 수 있습니다. 분류 모델과 메인 모델은 기본적으로 `gpt-5.6-luna`를 사용합니다.

| 분류 결과 | 처리 |
| --- | --- |
| `search_cards` | 메인 모델이 원문과 검색 도구를 받습니다. |
| `prepare_purchase` | 구매 카드·전략·USDC 상한·할인 조건을 구조화한 뒤 Mock 구매 미리보기 도구를 호출합니다. |
| `get_valuation` | 메인 모델이 원문과 검색·적정가 도구를 받습니다. 적정가 도구는 해당 턴의 검색 결과에 있는 variant ID만 조회합니다. |
| `needs_clarification` | 코드가 카드 정보를 요청합니다. |
| `unsupported` | 판매·직접 결제 등 지원하지 않는 요청의 범위를 안내합니다. |

메인 모델의 도구 루프는 SDK Runner에서 최대 6회로 제한합니다. 카드 검색과 적정가 도구는 주입받은 서비스와 공통 DTO를 사용합니다.

## 검증

저장소 루트에서 실행합니다. 자동 테스트는 가짜 모델과 기존 Mock 서비스를 사용합니다.

```sh
pnpm --filter @tcg/agent typecheck
pnpm --filter @tcg/agent test
pnpm --filter @tcg/agent build
```

실제 모델로 확인하려면 저장소 루트의 `.env` 또는 셸 환경에 `OPENAI_API_KEY`를 설정합니다. 데모에서는 `OPENAI_DECISION_MODEL`로 분류 모델을, `OPENAI_MODEL`로 메인 모델을 지정할 수 있습니다. 카드·가격 데이터는 Mock 서비스에서 조회합니다.

```sh
pnpm --filter @tcg/agent demo "피카츄 적정가 알려줘"
pnpm --filter @tcg/agent eval:intents
```

`eval:intents`는 [테스트셋](test/fixtures/intents.ts)의 한국어·영어 요청으로 실제 분류 모델을 호출해 경로와 언어를 비교합니다. 불일치하거나 API 호출에 실패하면 종료 코드 1을 반환합니다.

## MCP 연결

카드 조회용 Streamable HTTP 서버를 사용할 때는 루트 `.env`에 `AGENT_MCP_URL`을 설정합니다. 서버가 Bearer 인증을 요구하면 `AGENT_MCP_TOKEN`도 설정합니다.

```dotenv
AGENT_MCP_URL=http://127.0.0.1:4000/mcp
```

이 주소는 서버가 `/mcp`를 제공할 때의 예시입니다. 데모 명령은 동일하며, `AGENT_MCP_URL`을 비워두면 기존 로컬 Mock 서비스를 사용합니다.

```sh
pnpm --filter @tcg/agent demo "피카츄 적정가 알려줘"
```

서버는 `search_cards({ query, limit })`와 `get_valuation({ cardVariantId })`를 제공해야 합니다. 성공 응답은 `{ ok: true, data }`를 `structuredContent` 또는 단일 JSON 텍스트 블록으로 전달합니다. 검색의 `data`는 `{ items, nextCursor: null }`이며, 적정가는 공통 `Valuation` DTO입니다.

호스트 코드에서는 `await connectMcpCardServices({ url, headers })`의 반환값을 기존 `createAgentRuntime()`에 전달하고, 사용이 끝나면 `close()`를 호출합니다. 에이전트의 의도별 도구 제한과 현재 턴의 카드 ID 검증은 MCP를 사용할 때도 적용됩니다.

## 세션 HTTP/SSE

Web처럼 선택 UI를 제공하는 소비자는 `runAgentTurn(message, { onCardChoices })`로 카드 후보 콜백을 받을 수 있습니다. 이 옵션이 있을 때만 `show_card_choices` 도구와 관련 지침을 추가하며 기존 문자열 반환과 CLI 도구 구성은 유지합니다. 도구는 그 턴에 검색한 카드 ID만 허용하고 최대 10개의 서로 다른 후보를 전달합니다. 모델이 사용자 조건에 맞는 후보를 선택하며 텍스트 목록을 파싱하지 않습니다. 세션 Plugin은 공통 `agentChatReplySchema`로 검증한 후보를 SSE completed.message의 optional cardChoices와 세션 메시지에 보존합니다. 다음 턴에는 후보를 자동 재사용하지 않으며, 선택 후 적정가 도구도 새 턴의 검색 검증을 그대로 거칩니다.

로컬 웹 채팅은 루트 `.env`에 `OPENAI_API_KEY`와 `AGENT_LOCAL_SECRET`이 있으면 `pnpm dev`에서 사용할 수 있습니다. `pnpm env:init`은 새 로컬 환경에 `AGENT_LOCAL_SECRET`을 생성합니다. 기존 `.env`에는 `openssl rand -hex 32`로 생성한 값을 추가할 수 있습니다.

개발 모드의 루프백 주소에서 Web의 `POST /api/agent/chat`이 Core API에 서명된 브라우저 식별자를 전달하고 SSE를 중계합니다. 운영 환경에서 사용하려면 호스트의 인증 제공자를 연결해야 합니다.

Core API에서 검증된 `resolveAuth`를 주입하고 `createIntegrationPlugins`에서 Agent 세션 플러그인을 등록합니다. `requireAuth`는 `@tcg/api`가 제공하는 함수를 전달합니다.

```typescript
const app = await buildApp({
  resolveAuth,
  createIntegrationPlugins: async deps => [async host => {
    const runtime = createAgentRuntime(deps);
    await host.register(createAgentSessionPlugin({ runtime, requireAuth }), { prefix: '/api' });
  }],
});
```

| 요청 | 응답 |
| --- | --- |
| `POST /api/agent/sessions` | `201`과 세션 ID 및 빈 메시지 목록 |
| `GET /api/agent/sessions/:sessionId` | 세션 ID 및 최근 메시지 목록 |
| `POST /api/agent/sessions/:sessionId/messages` | `{ message }`를 받아 SSE로 `started`와 `completed` 또는 `error` 발행 |

`completed`의 `message`에 최종 답변이 담깁니다. 브라우저에서는 POST 응답의 스트림을 `fetch()`로 읽습니다. 요청은 인증 컨텍스트의 사용자와 Agent가 일치하는 세션에만 접근할 수 있습니다. 같은 세션은 한 번에 한 턴을 처리합니다.

세션은 프로세스 메모리에 저장하며, 최근 24개 메시지를 다음 턴에 전달합니다. 세션은 마지막 성공 턴 이후 1시간 동안 유지되고, 서버를 재시작하면 초기화됩니다. 이 대화 세션은 메모리 미리보기 전용입니다. 정책 기반 서버 실행은 아래 별도 플러그인을 사용합니다.

## 구매 조건 해석과 Mock 미리보기

`createOpenAIPurchaseConditionApi()`는 사용자 원문을 별도의 구조화 출력 모델에 전달해 공통 `PurchaseCondition`을 추출합니다. `cardQuery`, `strategy(FIXED|LIMIT|MARKET)`, 필수 `maxPrice`(USDC 최소 단위), `minDiscountPercent`(없으면 null)를 반환합니다. 카드명 또는 건당 USDC 상한이 불명확하면 조건은 null이며 확인 질문을 반환합니다. 다른 통화를 자동 환산하거나 총예산을 건당 상한으로 대체하지 않습니다.

`createAgentRuntime()`에 `purchaseConditionApi`, `purchasePreviewTool`을 주입할 수 있습니다. 기본 도구는 `createMockPurchasePreviewTool()`이며 해석한 조건을 검증·반환하는 미리보기만 실행합니다. 결과 조건이 원래 조건과 다르면 실패 처리합니다. 실제 주문·예약·서명·결제는 실행하지 않으며 응답에도 이를 표시합니다. 이 경로의 해석 모델과 Mock 도구는 독립 테스트에서 주입 가능하고 카드 검색·가격 조회 경로는 유지합니다.

```sh
pnpm --filter @tcg/agent demo "피카츄를 30 USDC 이하 지정가로 구매해줘"
```

## 세션 중단과 Trading 연결 경계

`POST /api/agent/sessions/:sessionId/stop`은 인증된 소유자의 세션을 중단하고 실행 중인 턴의 AbortSignal을 취소합니다. 중단된 세션은 새 턴을 거부합니다. `createAgentSessionPlugin()`의 `onSessionStarted(auth, sessionId)`와 `onSessionStopped(auth, sessionId)`는 서버 측 활성 상태 관리자를 연결하는 선택적 콜백입니다. 명시적 중단·1시간 유휴 만료·호스트 종료에 중단 콜백을 호출합니다. SSE 연결 종료는 실행/중단 콜백에 영향을 주지 않습니다. 만료는 조회·생성 및 1분 주기 작업으로 정리합니다. 중복 중단은 콜백을 한 번만 완료하며 실패한 콜백은 재시도할 수 있습니다.

호스트는 `onSessionStopped`에서 먼저 해당 세션의 online 상태를 해제한 뒤, 해당 사용자·Agent에 다른 활성 세션이 없으면 `tradingService.pauseAgentOrders(auth)`를 호출합니다. 이미 제출된 결제는 중단하지 않습니다. Trading에 같은 상태 관리자의 `TradingExecutionContextReader`를 주입해야 합니다. 콜백에는 요청 본문의 사용자 ID를 사용하지 않습니다. Core API는 별도의 영속 정책·서버 실행 서비스를 연결합니다. 기존 대화 플러그인을 운영 실행 상태 저장소로 사용하지 않습니다.

`createAgentExecutionController({ resolvePolicy, pauseOrders })`는 이 단일 호스트 연결을 제공합니다. 서버 측 정책 조회 함수와 Trading의 `pauseAgentOrders`를 주입하고 반환된 `executionContext`를 Trading에, `onSessionStarted`·`onSessionStopped`를 세션 Plugin에 전달합니다. 현재 승인 정책을 매 조회마다 재검증하고 같은 Agent의 마지막 세션이 중단될 때만 주문을 중지합니다. 중지 실패 중에도 offline 상태를 유지하며 재시도를 허용합니다. 정책 없는 구매 실행 세션의 시작은 거부합니다. 이 컨트롤러를 운영 팩토리에 자동 등록하거나 사용자 입력으로 정책을 승인하지는 않습니다.

## 영속 서버 실행과 MCP 작업 키

Core API는 `createServerRunPlugin({ runs, requireAuth, execute })`을 등록합니다. POST `/sessions`는 policyId·instruction·Idempotency-Key로 실행을 생성하며 GET 목록/상세, POST `/:id/stop`, GET `/:id/events`로 제어·조회합니다. SSE는 현재 스냅샷이며 과거 로그 재생은 없습니다. 연결 해제는 실행에 영향을 주지 않습니다. 정책 비활성화·명시적 중단·기한 만료는 서버 작업의 취소 신호로 전달합니다.

`execute`(Core API `executeAgentRun`)는 실제 작업 실행기의 주입점입니다. 기본 진입점에는 실제 LLM 구매·서명 실행기가 없으며 기존 `createAgentRuntime`의 구매는 여전히 Mock입니다. 작업 결과는 DB에 저장하고 서버 재시작 때 RUNNING 실행을 재인계합니다. 단일 작업 호스트를 전제하며 여러 호스트의 작업 임대는 제공하지 않습니다.

`createServerMcpClient({ url, headers, keyFor })`는 작업별 영속 키를 받아 HTTP 전송 실패에 같은 키/인수로 재시도합니다. `keyFor`에 `policies.actionKey(auth, runId, action, input)`를 연결합니다. 같은 작업 이름의 다른 인수는 충돌이며 새 탐색/의도에는 서버가 새 작업 이름을 할당해야 합니다. 서명은 모델 인수 대신 x402 메타데이터로 보냅니다. 지급 서명 생성은 이 클라이언트의 기능이 아닙니다.
