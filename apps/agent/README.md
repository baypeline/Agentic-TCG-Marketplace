# Agent Runtime

담당: 최재민

`createAgentRuntime({ aggregatorService, valuationService, model, decisionApi })`로 런타임을 생성합니다. `runAgentTurn(message)`는 Decision API로 의도를 분류한 뒤 독립된 한 턴의 최종 응답을 반환합니다. 기본 분류기는 OpenAI Responses API 구조화 출력을 사용하며, 같은 `DecisionApi` 인터페이스의 구현을 주입할 수 있습니다. 분류 모델과 메인 모델은 기본적으로 `gpt-5.6-luna`를 사용합니다.

| 분류 결과 | 처리 |
| --- | --- |
| `search_cards` | 메인 모델이 원문과 검색 도구를 받습니다. |
| `get_valuation` | 메인 모델이 원문과 검색·적정가 도구를 받습니다. 적정가 도구는 해당 턴의 검색 결과에 있는 variant ID만 조회합니다. |
| `needs_clarification` | 코드가 카드 정보를 요청합니다. |
| `unsupported` | 코드가 지원 범위를 안내합니다. |

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

세션은 프로세스 메모리에 저장하며, 최근 24개 메시지를 다음 턴에 전달합니다. 세션은 마지막 성공 턴 이후 1시간 동안 유지되고, 서버를 재시작하면 초기화됩니다. Core API의 인증 제공자 연결, 세션 영속화 및 x402 Client는 후속 통합 범위입니다.
