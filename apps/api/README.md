# Fastify Core API

로컬 채팅 예산 설정은 `agent-budget.ts`가 기존 PolicyService에 연결합니다. 총예산·건당 한도만 수정하며 기존 소비·예약·허용 카드·유효기간·활성 상태를 보존합니다. 모델은 변경안만 제시하고 웹의 확인 버튼으로 저장합니다. [예산 설정과 검증](../../docs/agent-budget.md)을 참고하세요.

`RWA_ENABLED=true`에서는 `packages/rwa` 서비스를 등록해 `/api/rwa`·고정 NFT 업무·기존 요청 상태 조회와 finalized 이벤트 수집을 제공합니다. 기존 MCP/Trading/Payment에 선택적 RWA 요구 생성·조회 장식·일반 DB 매물 변경 가드를 주입합니다. [실행·역할·x402 정산](../../docs/rwa.md)을 참고하세요.

`PAYMENT_CHAIN=maroo`는 별도 tOKRW 거래 DB·서버 서명·자체 퍼실리테이터로 동작합니다. DB 초기화·보존·18자리 원장·구매자 가스비는 [마루 가이드](../../docs/maroo.md)를 따르세요. `pnpm maroo:init` 후 퍼실리테이터를 초기화·재생성하고 서버를 재시작합니다.

`PAYMENT_FACILITATOR_URL`·`PAYMENT_FACILITATOR_TOKEN`으로 별도 자체 퍼실리테이터를 연결할 수 있습니다. 가스 지갑은 API 구매 지갑과 분리하며, 생성·별도 Docker 프로젝트 실행·정산 원장 복구는 [퍼실리테이터 가이드](../facilitator/README.md)를 참고하세요. 미설정 시 기존 공개 x402 퍼실리테이터를 사용합니다.

`buildApp()`은 조립, 오류 처리, 인증 컨텍스트 및 자원 수명을 관리합니다. `server.ts`만 `listen()`을 호출합니다. 업무 로직은 packages의 Service에서 주입합니다.

운영 진입점은 Trading REST(`/api`)와 MCP(`/mcp`)를 등록합니다. 거래 모드, 로컬 인증, DB 시연 재고와 요청 예시는 [트레이딩 통합 가이드](../../docs/trading-integration.md)를 참고하세요. 정책·예산·서버 실행 REST, 결제/체결 복구 및 MCP 거래 도구를 함께 연결합니다. Web은 검증된 신원 조회(`/api/me`)와 정책·수동 거래 제어·매물·주문·예약 관리 및 상태 조회를 연결합니다. 지급 서명/실행은 Web 경로에 제공하지 않습니다.

카드 조회는 공개입니다. 인증은 `resolveAuth`로 주입하고 보호된 라우트는 `requireAuth`를 호출합니다. 루트 `.env`를 읽으며 기본 포트는 4000입니다. 통합 확장점은 루트 `docs/integration.md`를 확인하세요.

로컬 Web 채팅의 카드 검색·적정가 조회는 `Agent → 같은 호스트의 /mcp → Aggregator/Valuation` 순서로 호출합니다. 서버가 listen한 실제 주소로 카드 도구를 처음 사용할 때 연결하고 턴 종료 시 정리합니다. 브라우저의 세션 토큰은 공개 카드 MCP에 전달하지 않으며 거래 도구는 Agent에 제공하지 않습니다. MCP 연결이나 조회가 실패하면 직접 Service나 Mock으로 우회하지 않습니다. 기본 요청 제한은 10초이며 명시적 중단·턴 제한 신호도 전달합니다. `buildApp()`만 만든 HTTP 통합 테스트는 `listen({ port: 0 })` 후 채팅을 호출해야 합니다.

루트에서 `pnpm --filter @tcg/api test`와 `pnpm --filter @tcg/api typecheck`로 검증합니다.

`DEMO_SCENARIOS_ENABLED=true`는 수집본에서 파생한 합성 카드 3종으로 검색 범위를 제한하고 고정 MOCK 시세를 사용합니다. 구매는 소유자 대화에 저장된 매물만 허용하며 서버가 기존 Policy/Trading/Payment 서비스와 MCP 예약·지급·상태 조회를 조립합니다. 데모 구매자 역할의 총예산은 0.1, 건당 한도는 0.025 USDC입니다. 결제·소유권 이전·멱등성 로직은 원래 모듈이 처리하고 호스트는 서명 원문을 저장하지 않습니다. [데모 가이드](../../docs/demo-scenarios.md)를 참고하세요.

`GET /api/cards/:id/prices`는 DB에 저장된 외부 참고 시세와 strict 기준의 판본·환율 검증 상태를 제공합니다. 쓰기용 공개 API는 없습니다. `PRICE_DATA_SOURCE=market`에는 DB 카드 조회가 필요합니다. `MARKET_VALUATION_MODE=demo`(기본)는 TCGplayer의 대표 USD 시장 집계가를 1 USD ≈ 1 USDC로 표시하고, `strict`는 검증된 표본만 평가합니다. 실제 수집 가격과 합성 Mock은 섞지 않으며 `/health.priceDataSource`와 `marketValuationMode`로 선택 모드를 확인합니다. 수집·평가 정책은 `@tcg/valuation`이 소유하고 호스트는 Service·Plugin만 조립합니다.

## 거래·결제·서버 실행

기본 조립은 공유 저장소에서 정책과 RUNNING 실행을 조회해 거래를 승인합니다. 구매자 인증만으로 online이 되지 않으며 `/api/policies` 생성 후 `/sessions`에 policyId를 연결해야 합니다. 정책별 예산과 적용 버전은 DB 거래 모드에서 재시작 후에도 보존됩니다. `tradingExecutionContext`는 테스트·사용자 정의 호스트의 신뢰 가능한 대체 제공자용이며 결제 제출은 반드시 저장된 정책·실행을 다시 검사합니다.

매물·주문·예약·매칭·정책 생성/수정·서버 실행 생성에는 `Idempotency-Key`가 필요합니다. 동일 키의 다른 인수는 409, 같은 인수는 최초 결과를 반환합니다. 현재 예약과 지급 상태는 `/api/purchases/:id/status`로 조회합니다.

`buildApp({ executeAgentRun })`은 브라우저 연결과 독립적으로 서버 작업을 실행하는 주입점입니다. 기본 진입점에는 LLM 백그라운드 구매 작업이 연결되지 않았습니다. `AGENT_SIGNING_MODE=server`는 사용자가 승인한 시나리오 구매의 지급 서명만 전용 지갑에 연결합니다. `agent-wallet.ts`에서 개인키를 읽고 금액·수납처·토큰·네트워크·잔액을 검사하며 MCP에 서명된 x402 payload만 전달합니다. Payment가 정책·예산을 다시 검사하고 정산합니다. 작업을 주입한 단일 호스트는 DB의 RUNNING 작업을 부팅 시 다시 인계합니다. 호스트 종료는 작업을 인계하며 명시적 중단과 구분합니다.

`paymentOptions`로 검증/정산/기존 증빙 조회 어댑터와 사용자별 지갑 주소 제공자를 주입합니다. 기본 진입점의 `PAYMENT_ENABLED=true`는 DB 거래 모드·수납 주소·Agent 공개 지갑 주소가 있어야 유효하며 Base Sepolia의 x402 어댑터를 사용합니다. 기본값은 false입니다. 데모 지갑 연결은 고정 데모 구매 Agent에만 적용됩니다. 실제 사용자 인증·지갑 소유권 확인은 호스트 제공자 책임입니다.

복구 작업은 실행 기한·미제출 예약 만료와 결제 증빙 확인·체결 재시도를 순서대로 수행합니다. UNKNOWN은 TTL로 해제하지 않으며 새 지급하지 않습니다. 상세 DTO·환경 설정·외부 검증 한계는 [API 계약서](../../docs/api-contract.md)와 [통합 가이드](../../docs/trading-integration.md)에 있습니다.
