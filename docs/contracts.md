# 공통 계약 결정 사항

사용자 지갑 계약: `walletUserSchema.agentWalletAddress`와 `agentWalletInfoSchema`를 제공합니다. Core `GET /api/agent/wallet`은 본인 공개 주소·체인·통화·최소 단위 잔액(조회 실패 시 null)·시각만 반환합니다. [자동 발급](managed-agent-wallet.md)을 참고하세요.

`AuthContext.walletAddress`는 서명 검증·유효 세션 조회를 거쳐 서버가 설정합니다. `walletChallengeSchema`, `walletSessionSchema`와 로그인 입력 DTO를 추가했습니다. 웹 로그인 응답에는 세션 토큰을 포함하지 않으며 HttpOnly 쿠키로만 전달합니다. `/api/me`는 인증된 사용자·Agent에 `agentWalletLinked`, `rwaAvailable`을 함께 반환합니다. [지갑 로그인](wallet-login.md)을 참고하세요.

채팅 응답에는 선택적 `budgetProposal`을 추가했습니다. `agentBudgetPatchSchema`는 현재 통화와 사람이 입력한 십진수 금액을, `agentBudgetProposalSchema`는 변경 전후 최소 단위 금액·정책 버전·지출·예약·만료를 정의합니다. 확인 요청은 `agentBudgetActionSchema`의 `proposalId`·`confirm/cancel`만 받으며 클라이언트 금액이나 정책 ID를 쓰기 입력으로 받지 않습니다. `agentBudgetResultSchema`는 적용 결과와 실제 예산을 반환합니다. [상세 흐름](agent-budget.md)을 참고하세요.

기준: 사용자 제공 API 계약서 v2.0·시스템 설계서 v2.1 및 2026년 11월 24일 합의. 개정본은 [API 계약서 v2.1](api-contract.md), [시스템 설계서 v2.2](system-design.md), 확정 규칙과 구현 차이는 [합의 사항](decisions.md)에 있습니다.

이 문서는 현재 DTO·구현 확장도 함께 설명합니다. 정책 ID·버전, 서버 실행 수명, 예약 보류, TRANSFERRED 제거는 코드에 반영했습니다. Web 수동 거래 폼도 연결했으며 실제 LLM 구매 실행기·서명기 주입은 남아 있습니다.

- ID: 계약서 본문의 UUID 원칙을 따릅니다. `card-001` 등의 예시는 실제 ID로 사용하지 않습니다.
- 평가·거래 가격: USDC 6 decimals, 음수·소수·지수 표기를 허용하지 않는 정수 문자열. 계산과 표시는 BigInt를 사용합니다. 외부 참고 시세의 원본 금액은 아래 별도 계약을 사용합니다.
- 날짜: UTC ISO 8601 문자열.
- 검색 응답: `{ items: CardVariant[], nextCursor: null }`. 현재 커서 페이지네이션은 미구현입니다. `limit`는 1~100입니다.
- REST 성공: 계약서의 직접 DTO 응답 형식을 따릅니다. MCP의 `{ ok, data }` 래퍼를 REST에 적용하지 않습니다.
- REST 오류: `{ error: { code, message, retryable }, requestId }`.

## 카드의 원문명·표시 이름·인쇄 언어

`CardVariant.name`은 수집한 원문 이름이며 `language`는 카드 인쇄 언어입니다. 한국어 UI를 제공하기 위해 인쇄 언어를 KO로 바꾸거나 name을 덮어쓰지 않습니다. optional 표시 이름 필드를 추가했습니다.

```typescript
localizedNames?: {
  locale: 'ko';
  name: string;
  source: 'POKEAPI_SPECIES';
  sourceUrl: string;
}[];
```

예를 들어 `name: "Pikachu"`, `language: "EN"`인 카드에 `localizedNames[0].name: "피카츄"`를 제공할 수 있습니다. source는 종명 대응을 뜻하며 한국어판 카드별 정식 제목을 보증하지 않습니다. 대응되지 않는 이름은 추가하지 않고 원문으로 표시합니다. 기존 필드·UUID·거래 식별 속성은 유지합니다. DB 검색은 원문명과 한국어 이름을 모두 지원합니다.

## 팀 검토가 필요한 Valuation 확장

초안의 '가격 부재를 표현하는 별도 상태' 요구를 다음처럼 구체화했습니다.

```typescript
type Valuation = {
  cardVariantId: string;
  currency: 'USDC';
  sampleSize: number;
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  evaluatedAt: string;
  sourceSummary?: string[];
  dataSource: 'MOCK' | 'MARKET';
  oldestObservedAt?: string;
  latestObservedAt?: string;
  methodology?: 'MEDIAN_OF_MOCK_SAMPLES' | 'MEDIAN_OF_PROVIDER_AGGREGATES';
} & (
  | { status: 'AVAILABLE'; estimatedPrice: string; sourceSummary: string[] }
  | { status: 'INSUFFICIENT_DATA'; estimatedPrice: null; sampleSize: 0; confidence: 'LOW' }
);
```

가격 부재 시 confidence는 LOW만 허용합니다. 초기 평가는 중앙값이며 짝수 표본은 정수 평균의 소수 최소 단위를 버립니다. 현재 신뢰 수준은 항상 LOW이며 표본 수만으로 HIGH를 만들어 내지 않습니다. 합성 가격은 실제 거래 판단에 사용하면 안 됩니다.

### 구현 계약의 세부 검증 규칙

- `AVAILABLE`은 `sampleSize >= 1`과 비어 있지 않은 `sourceSummary`를 요구합니다.
- `INSUFFICIENT_DATA`는 `sampleSize: 0`, `estimatedPrice: null`, `confidence: LOW`를 요구합니다.
- 제공자 가격 표본은 `amount`(양의 USDC 최소 단위 정수 문자열), `source`(빈 문자열 불가), `observedAt`(UTC ISO 8601)을 제공합니다. 미래 관측 시각이나 잘못된 표본은 서버의 제공자 오류(HTTP 500)로 처리하며 입력 오류로 돌리거나 임의 가격으로 대체하지 않습니다.
- `evaluatedAt`은 표본 조회를 시작한 계산 시점이며, `oldestObservedAt`·`latestObservedAt`은 사용한 표본의 관측 시각 범위입니다. 자료가 없으면 범위를 생략합니다. MARKET 어댑터는 가격 72시간·환율 24시간 유효기간을 적용하며 신뢰 수준은 LOW로 유지합니다.
- DB 어댑터도 `MOCK` 표본만 최대 100개(관측 시각 내림차순, 동일 시각은 ID 순) 읽습니다. `MARKET` 표본을 합성 평가에 섞지 않습니다.
- 메모리 Mock과 DB seed는 `@tcg/contracts/fixtures`의 동일 카드 UUID와 가격 표본을 사용합니다. fixtures는 시연용이며 실제 카드·시세 자료가 아닙니다.

위 규칙은 이번 구현에서 코드·테스트로 고정한 계약안입니다. 팀 합의가 완료되었다는 의미는 아니며 MCP·Trading·Payment 담당자와 공유·검토해야 합니다.

Aggregator의 `CardDataAdapter`, Valuation의 `PriceDataAdapter`는 실제 제공자 구현을 위한 교체 경계입니다. 외부 카드와 가격 수집·저장을 구현했으며 가격 수집과 검증 표본 평가는 Valuation이 소유합니다.

### 외부 참고 시세 REST 확장

`GET /api/cards/:id/prices`는 `marketPricesResponseSchema`로 검증합니다. 응답은 `{ cardVariantId, dataSource: 'MARKET', items, maxAgeHours, evaluatedAt }`입니다. 존재하지 않는 카드는 404이며 저장된 시세가 없으면 빈 items입니다. 가격 수집·검증 쓰기용 공개 REST는 없습니다.

각 item은 `id`, `provider: CARDMARKET|TCGPLAYER`, `providerVariant`, `priceType`, `originalCurrency: EUR|USD`, `originalAmount`(원본 통화의 소수 문자열, 최대 6자리), `sourceUrl`, `observedAt`, `collectedAt`, `eligibility`를 포함합니다. 원본 금액을 USDC 정수로 해석하면 안 됩니다. observedAt은 제공자 가격 갱신 시각이며 개별 체결 시각이 아닙니다.

- priceType: ASKING_LOW / PROVIDER_MARKET / PROVIDER_AVERAGE / PROVIDER_TREND. 개별 체결가는 포함하지 않습니다.
- eligibility: ELIGIBLE / UNVERIFIED_VARIANT / STALE_PRICE / STALE_FX / VARIANT_MISMATCH / UNSUPPORTED_PRICE_TYPE.
- 검증 기록이 있으면 optional `assessment`에 확인 속성(language, edition, condition), matchEvidenceUrl, usdcAmount, fxRate, fxSourceUrl, fxObservedAt, assessedAt을 제공합니다. fxRate는 원본 통화 1단위당 USDC입니다. 검증 기록이 있어도 만료·속성 변경으로 평가에서 제외될 수 있습니다.
- strict 평가에는 제공자별 최신 검증 집계가를 최대 한 개 사용합니다. sampleSize는 집계 표본 수이며 실제 거래 건수가 아닙니다. 판매 희망가·추세가·미검증 판본을 실제 거래 가능 가격으로 보증하지 않습니다.
- `PRICE_DATA_SOURCE=mock`은 기존 평가를 유지하며 market은 DB 카드 조회가 필요합니다. 두 출처를 혼합하지 않고, 적합한 시장 표본이 없으면 INSUFFICIENT_DATA입니다.

Valuation의 추가 필드는 optional이고 기존 USDC·UUID·오류 코드와 거래 DTO는 유지했습니다. MCP·Trading·Payment 소비자는 확장 필드와 표본 수의 의미를 함께 검토해야 합니다. [수집·검증 명령과 제한](../packages/valuation/README.md)을 확인하세요.

2026년 11월 24일 데모 정책 변경: `MARKET_VALUATION_MODE=demo`를 기본으로 사용합니다. TCGplayer의 최신 USD `PROVIDER_MARKET` 대표 가격 하나를 1 USD ≈ 1 USDC로 표시하며 판본·상태·환율 승인을 요구하지 않습니다. EUR·판매 희망가·만료 가격은 포함하지 않습니다. 기존 strict 경로와 검증 기록은 유지합니다. Valuation은 실제 출처인 `dataSource=MARKET`을 유지하고 `methodology=DEMO_USD_REFERENCE` 및 optional `assumptions: string[]`로 데모 가정을 전달합니다. `estimatedPrice`는 여전히 소수 6자리의 USDC 최소 단위 정수 문자열이며 `sampleSize`는 대표 제공자 표본 1개입니다. `/prices.eligibility`는 계속 strict 검증 상태이므로 데모 가격의 존재와 별개입니다. 공유 Schema와 MCP 응답, Web·Agent 소비자는 이 구분을 함께 사용합니다.

Inventory·Listing·BuyOrder·MatchQuote·Trade의 기존 DTO를 유지한 Trading Service와 REST Plugin을 통합했습니다. 입력은 `@tcg/contracts`의 공유 Zod Schema로 검증하며 구매에는 인증된 userId·agentId가 필요합니다. 체결은 결제 시도 ID·예약 ID·통화·금액이 일치하는 서버 측 SETTLED 증빙을 요구합니다. SpendingPolicy는 Trading 실행 경계에서 검증하며 영속 정책·누적 예산·Payment 기록과 x402 MCP 전송을 연결합니다. 실제 지급은 명시적 DB/결제 설정이 필요합니다. 경로와 결제 경계는 [Trading README](../packages/trading/README.md), [통합 가이드](trading-integration.md)를 참고하세요.


## 거래 계약 정합성 보정

- 공유 거래 입력은 `@tcg/contracts`에서 제공하며 시장가의 maxPrice는 필수입니다.
- 매물·주문·예약 생성은 Idempotency-Key를 요구합니다. 같은 인증 주체·작업·키의 동일 입력은 최초 응답을 반환하며 다른 입력은 IDEMPOTENCY_CONFLICT(409)입니다. 판매 매물은 사용자, 구매 요청은 사용자와 Agent에 결합합니다.
- 정식 예약 경로는 POST /api/purchases/fixed/quote, POST /api/purchases/market/quote입니다. 기존 /api/quotes/*와 DELETE 주문 취소는 호환 별칭으로 유지합니다.
- 매물·예약·주문·거래 응답은 공통 도메인 DTO의 id를 사용합니다. 2026년 11월 24일 사용자 합의로 객체 자신의 식별자는 id, 다른 객체 참조는 listingId·matchQuoteId 등으로 통일했습니다. 저장소 개정 계약서의 예시에도 반영했으며 첨부 원본은 변경하지 않았습니다.
- 신규 예약·매칭·주문 재개는 검증된 활성 Agent와 사전 승인 정책을 요구하며 제공자 미주입은 거부합니다. 누적 예산 예약·차감은 같은 저장소의 Payment가 원자적으로 처리합니다.


## 2026년 11월 24일 확정 업무 규칙

- 정책 id·version을 부여하고 예산은 정책 ID별 누적으로 관리합니다. 재시작·수정·여러 세션에도 사용 완료액·결제 예약액을 공유하며 총예산 감액 하한은 두 금액의 합입니다.
- 정책 변경과 결제 제출 승인은 서버 DB 확정 순서를 따릅니다. 외부 정산 요청 전에 최신 정책 검사·예산 예약·카드 보호·적용 버전 기록을 같은 트랜잭션에 확정합니다.
- 정책 변경·Agent 중단만으로 기존 미제출 예약을 취소하지 않습니다. 결제를 보류하고 사유를 알리며 원래 expiresAt을 유지합니다. 제출 승인된 결제는 별도 보호·복구 대상으로 유지합니다.
- UNKNOWN에서는 새 지급을 만들지 않고 카드·예산 예약을 보호하며 서버가 복구합니다. 결제와 거래 상태를 분리하고 정산 성공 시 예산을 사용 완료로 전환합니다.
- Agent 실행은 서버가 관리합니다. 브라우저·SSE 연결 종료는 중단 사유가 아니며 명시적 중단 시 대기 주문만 PAUSED, 미제출 예약은 보류, 제출 결제는 복구 계속입니다.
- TRANSFERRED를 제거하고 동일 카드 UUID·구매자 ownerId·AVAILABLE를 사용합니다. 이전 이력과 판매자 모의 수익의 근거는 완료된 Trade입니다.
- 가격 상한 구매는 적정가 없이도 가능하나 할인 조건에는 유효한 실제 시세가 필요합니다. 가격 72시간·환율 24시간 기준을 유지하며 Mock을 실제 지급 허용 근거로 쓰지 않습니다.
- 서버 실행 계층이 MCP 작업 키를 보관합니다. 재시도는 같은 키, 새로운 주문 의도·새 시장 탐색은 새 키입니다. 지정가·시장가 미매칭은 null이며 정책·예산 등 업무 오류와 구분합니다.

이 목록의 문서화는 구현 완료 선언이 아닙니다. 모듈별 검증 범위와 외부 연동 한계는 [구현 현황](decisions.md#현재-구현과-검증-범위)을 확인하세요.

## 조회 채팅의 카드 선택 후보

### 시나리오 매물·구매 확장

`agentChatReplySchema.purchaseOffers`는 optional 배열(최대 10개)입니다. 각 항목은 `{ listingId, card: CardVariant, price: USDC 최소 단위 문자열, dataSource: 'SYNTHETIC_DEMO', paymentMode: 'X402_BASE_SEPOLIA', paymentReady: boolean }`이며 listingId는 중복할 수 없습니다. 현재 턴에 검색한 카드의 활성 MCP 매물만 포함합니다. 모델의 문장이나 임의 ID에서 구매 버튼을 생성하지 않습니다.

`POST /api/agent/sessions/:sessionId/purchases`는 `{ requestId, listingId, action: prepare|submit|status|cancel, paymentPayload? }`를 받습니다. 호스트가 구매 콜백을 등록할 때만 활성화하며 기존 소유자 인증과 대화에 보존된 매물을 확인합니다. 금액·카드·구매자는 서버에서 결정하고 같은 requestId의 다른 매물은 거부합니다. prepare는 예약과 x402 요구만 만들고 submit에는 브라우저 지갑 서명이 필요합니다.

`agentPurchaseProgressSchema`는 requestId/listingId/card/amount/matchQuoteId/expiresAt/payer/recipient와 status(`PAYMENT_REQUIRED|PENDING|COMPLETED|CANCELLED|FAILED`), paymentMode를 제공합니다. optional requirements는 exact·Base Sepolia·지정 USDC 토큰만 허용하며, tradeId/transactionHash는 확인된 결과가 있을 때 제공합니다. PENDING은 새 지급 없이 status로 확인하고 COMPLETED는 Payment SETTLED와 Trade를 함께 확인한 상태입니다. 정책·예산·결제 및 체결 DTO 자체는 변경하지 않았습니다.

`agentChatReplySchema`는 `{ content: string, cardChoices?: CardVariant[], purchaseOffers?: AgentPurchaseOffer[] }`입니다. SSE completed.message는 기존 role/content를 유지하며 선택이 필요할 때만 cardChoices를 포함합니다. 후보는 1~10개, UUID 중복 없이 검증합니다. 기존 문자열 응답 소비자는 확장 필드를 무시할 수 있습니다.

세션 SSE는 `started` 이후 생성 중인 텍스트를 `delta` 이벤트의 `{ delta: string }`으로 전달합니다. `agentTextDeltaSchema`로 검증하며 도구 인자·추론 내용은 보내지 않습니다. `completed.message`가 최종 답변과 후보의 기준이고 중간 텍스트와 다를 수 있습니다. `error`나 완료 이벤트 없는 연결 종료는 미완료로 처리하고 후보를 활성화하지 않습니다. 고정 응답처럼 delta가 없는 경로도 지원합니다. 서버 대화 기록에는 성공한 최종 답변만 저장합니다.

후보는 해당 턴의 검색 결과에서 `show_card_choices`가 선택한 카드만 전달합니다. Web은 마크다운의 번호·이름을 해석하지 않고 구조화된 UUID·세트·번호·언어·판본·상태로 조회 대상을 표현합니다. 선택은 후속 적정가 질문이며 주문·구매 승인이나 소유권 검증을 대신하지 않습니다. 실제 적정가 조회 시에는 기존 도구의 현재 턴 검색 ID 검증을 유지합니다. 런타임의 optional `onCardChoices` 콜백과 Web의 `readAgentMessage`가 이 확장을 사용하고 기존 `readAgentReply`는 문자열 반환을 유지합니다.
