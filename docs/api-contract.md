# 공통 API 계약서

**버전:** v2.1 — 합의된 업무 규칙 반영

**개정일:** 2026년 11월 24일

**담당:** 정연한 총괄, 각 모듈 담당자 공동 검토

원본은 사용자가 제공한 공통 API 계약서 v2.0입니다. 이 개정본은 이번 대화에서 사용자와 확정한 규칙을 반영합니다. 업무 규칙의 구현 현황과 실제 외부 연동 검증 범위는 [합의 사항](decisions.md)에 구분합니다. [시스템 설계서 v2.2](system-design.md)와 함께 사용합니다. 담당자 간 별도 공유·배포가 완료됐다고 의미하지 않습니다.

## 1. 공통 원칙

### 1.1. 호출 방식

| 경계 | 프로토콜 |
| --- | --- |
| Browser → Next.js | HTTP |
| Next.js BFF → Fastify | REST |
| Next.js BFF → Agent | HTTP / SSE |
| Agent → MCP Server | MCP Streamable HTTP |
| Fastify 내부 모듈 | TypeScript Service Interface |
| Payment → Facilitator | x402 SDK |
| Service → PostgreSQL | Prisma |

### 1.2. 기본 규칙

- JSON 필드는 camelCase를 사용한다.
- ID는 문자열 UUID를 사용한다. 객체 자신의 식별자는 id, 다른 객체 참조는 listingId·matchQuoteId·policyId처럼 역할 이름을 붙인다. 응답에 같은 식별자의 별칭을 중복 제공하지 않는다.
- 날짜는 UTC ISO 8601 문자열을 사용한다.
- 가격은 USDC 최소 단위의 정수 문자열로 교환한다.
- 1 USDC = 1,000,000 최소 단위다.
- 수량은 항상 1이다.
- 요청·응답 검증은 Zod를 사용한다.
- 주문·결제 생성은 멱등성을 지원한다.
- 사용자·Agent ID는 인증 컨텍스트에서 확정하며 클라이언트 제공값을 무조건 신뢰하지 않는다.

가격 예시:

```
{
  "amount": "12500000",
  "currency": "USDC",
  "decimals": 6
}
```

이는 12.5 USDC를 의미한다.

## 2. 공통 도메인 모델

### 2.1. CardVariant

```
type CardVariant = {
  id: string;
  game: "POKEMON";
  name: string;
  setCode: string;
  cardNumber: string;
  language: string;
  edition: string;
  condition: string;
  imageUrl?: string;
};
```

### 2.2. Valuation

```
type Valuation = {
  cardVariantId: string;
  currency: "USDC";
  confidence: "LOW" | "MEDIUM" | "HIGH";
  evaluatedAt: string;
  dataSource: "MOCK" | "MARKET";
  sourceSummary?: string[];
} & (
  | { status: "AVAILABLE"; estimatedPrice: string; sampleSize: number; sourceSummary: string[] }
  | { status: "INSUFFICIENT_DATA"; estimatedPrice: null; sampleSize: 0; confidence: "LOW" }
);
```

가격 부재는 0으로 표현하지 않습니다. AVAILABLE에서만 estimatedPrice가 정수 문자열이며 INSUFFICIENT_DATA에서는 null입니다. 구현의 상태 판별 DTO와 세부 검증 규칙은 [공통 계약 결정 사항](contracts.md)에 있습니다. 할인 조건 구매에는 유효한 실제 자료가 필요하고, 가격 상한만 있는 구매는 적정가 부재만으로 차단하지 않습니다. 가격 관측 72시간·환율 관측 24시간 및 카드 변형 일치 기준을 적용합니다. Mock 평가를 실제 테스트넷 결제 허용 근거로 사용하지 않습니다.

### 2.3. InventoryItem

```
type InventoryItem = {
  id: string;
  cardVariantId: string;
  ownerId: string;
  status: "AVAILABLE" | "LISTED" | "RESERVED";
};
```

### 2.4. Listing

```
type Listing = {
  id: string;
  inventoryItemId: string;
  cardVariantId: string;
  sellerId: string;
  price: string;
  status: "ACTIVE" | "RESERVED" | "SOLD" | "CANCELLED";
  createdAt: string;
};
```

### 2.5. BuyOrder

```
type BuyOrder = {
  id: string;
  agentId: string;
  cardVariantId: string;
  maxPrice: string;
  status:
    | "ACTIVE"
    | "PAUSED"
    | "MATCH_PENDING"
    | "FILLED"
    | "CANCELLED"
    | "EXPIRED";
  expiresAt: string;
  createdAt: string;
};
```

### 2.6. MatchQuote

```
type MatchQuote = {
  id: string;
  listingId: string;
  inventoryItemId: string;
  buyerAgentId: string;
  buyOrderId?: string;
  amount: string;
  currency: "USDC";
  status:
    | "RESERVED"
    | "PAYMENT_PENDING"
    | "SETTLED"
    | "COMPLETED"
    | "RELEASED"
    | "RECONCILING";
  expiresAt: string;
};
```

### 2.7. Trade

```
type Trade = {
  id: string;
  matchQuoteId: string;
  buyerId: string;
  sellerId: string;
  inventoryItemId: string;
  price: string;
  paymentAttemptId: string;
  status: "COMPLETED";
  completedAt: string;
};
```

### 2.8. SpendingPolicy

```
type SpendingPolicy = {
  id: string; // UUID
  version: number; // 수정 시 증가하며 이전 버전 보존
  agentId: string;
  enabled: boolean;
  totalBudget: string;
  maxPerTrade: string;
  allowedCardVariantIds?: string[];
  minDiscountPercent?: number;
  validUntil: string;
};
```

예산 검사는 실제 온체인 지갑 잔액 검사와 별개로 실행합니다. 총예산·사용 완료액·결제 예약액은 policyId 단위로 누적하며 여러 세션이 공유합니다. 재시작·정책 수정으로 초기화하지 않습니다. 사용 가능액은 totalBudget − 사용 완료액 − 결제 예약액입니다. 카드만 예약하고 결제를 제출하지 않은 금액은 결제 예약액에 넣지 않습니다. totalBudget을 사용 완료액 + 결제 예약액보다 낮추는 변경은 거부합니다. 정책 변경과 제출 승인은 서버 DB 확정 순서를 따르며 결제 제출 승인에 policyId·policyVersion을 저장합니다.

정책 입력은 id·version·agentId를 제외한 SpendingPolicy 필드이며, 수정에는 expectedVersion을 추가합니다. 수정은 전체 필드를 전달하는 PUT입니다. 버전 불일치는 IDEMPOTENCY_CONFLICT입니다.

```ts
type Budget = {
  policyId: string;
  totalBudget: string;
  spentAmount: string;
  reservedAmount: string;
  availableAmount: string;
};
```

## 3. REST API

아래 경로는 Core API의 통합 경로다. 보호된 경로에는 호스트가 검증한 인증 컨텍스트가 필요하다.

### 3.1. 카드·시세

| Method | Path | 기능 |
| --- | --- | --- |
| GET | `/api/cards` | 카드 검색 |
| GET | `/api/cards/:id` | 카드 상세 |
| GET | `/api/cards/:id/valuation` | 적정가 조회 |

카드 검색:

```
GET /api/cards?q=pikachu&limit=10
```

응답:

```
{
  "items": [
    {
      "id": "card-001",
      "game": "POKEMON",
      "name": "Pikachu",
      "setCode": "SV",
      "cardNumber": "001",
      "language": "EN",
      "edition": "NORMAL",
      "condition": "NM"
    }
  ],
  "nextCursor": null
}
```

### 3.2. Inventory·Listing

| Method | Path | 기능 |
| --- | --- | --- |
| GET | `/api/me` | 인증된 사용자·Agent 정보, 인증 토큰 제외 |
| GET | `/api/inventory` | 사용자 소유 카드 조회 |
| POST | `/api/listings` | 고정가 매물 등록 |
| GET | `/api/listings` | 활성 매물 조회 |
| GET | `/api/listings/:id` | 매물 상세 |
| DELETE | `/api/listings/:id` | 매물 취소 |

매물 등록:

```
{
  "inventoryItemId": "item-001",
  "price": "12000000"
}
```

응답(필드 발췌이며 실제 응답은 2.4절 Listing 전체 DTO를 반환):

```
{
  "id": "listing-001",
  "status": "ACTIVE"
}
```

등록자는 인증된 소유자로 결정한다.

### 3.3. 구매 전략

| Method | Path | 기능 |
| --- | --- | --- |
| POST | `/api/purchases/fixed/quote` | 특정 매물 예약 |
| POST | `/api/purchases/market/quote` | 최적 매물 선택·예약 |
| POST | `/api/buy-orders` | 매수 지정가 등록 |
| GET | `/api/buy-orders` | 주문 조회 |
| POST | `/api/buy-orders/:id/cancel` | 주문 취소 |
| POST | `/api/buy-orders/:id/pause` | 주문 중지 |
| POST | `/api/buy-orders/:id/resume` | 주문 재활성화 |
| POST | `/api/buy-orders/:id/match` | 대기 주문 매칭 시도 |

고정가 예약:

```
{
  "listingId": "listing-001",
  "maxPrice": "12000000"
}
```

시장가 예약:

```
{
  "cardVariantId": "card-001",
  "maxPrice": "13000000"
}
```

지정가 주문:

```
{
  "cardVariantId": "card-001",
  "maxPrice": "10000000",
  "expiresAt": "2026-11-30T00:00:00.000Z"
}
```

공통 예약 결과(필드 발췌이며 실제 응답은 2.6절 MatchQuote 전체 DTO를 반환):

```
{
  "id": "quote-001",
  "listingId": "listing-001",
  "inventoryItemId": "item-001",
  "amount": "12000000",
  "currency": "USDC",
  "status": "RESERVED",
  "expiresAt": "2026-11-20T12:05:00.000Z"
}
```

위 예시는 개발용 ID이며 실제 데이터는 UUID를 사용한다.

### 3.4. 거래 조회

| Method | Path | 기능 |
| --- | --- | --- |
| GET | `/api/trades` | 거래 내역 |
| GET | `/api/trades/:id` | 거래 상세 |
| GET | `/api/matches/:id` | 예약·체결 상태와 holdReasons·remainingMs |
| GET | `/api/matches` | 현재 구매 Agent의 예약 목록 |
| GET | `/api/purchases/:id/status` | PurchaseStatus 결제·거래 결합 상태 |
| GET | `/api/seller-proceeds` | 완료 Trade의 모의 판매 수익 `{ amount, currency: "USDC", tradeCount, withdrawable: false }` |

### 3.4.1. 정책·예산

| Method | Path | 기능 |
| --- | --- | --- |
| POST | `/api/policies` | 정책 생성, Idempotency-Key 필수 |
| GET | `/api/policies` | 현재 사용자·Agent의 정책 목록 |
| GET | `/api/policies/:id` | 최신 정책 |
| PUT | `/api/policies/:id` | 정책 수정, expectedVersion·Idempotency-Key 필수 |
| GET | `/api/policies/:id/versions` | 버전순 정책 이력 |
| GET | `/api/policies/:id/budget` | 정책별 Budget |


### 3.5. Agent

Core API는 서버 실행용 경로를 제공한다. Web BFF는 정책 저장·수동 실행 생성/중단과 거래 관리 요청을 전달한다. 기본 호스트의 LLM 실행기는 연결하지 않았으며 지급 서명·실행은 Web에서 제공하지 않는다.

| Method | Path | 기능 |
| --- | --- | --- |
| POST | `/sessions` | 정책에 연결한 서버 실행 생성, Idempotency-Key 필수 |
| GET | `/sessions` | 현재 사용자·Agent 실행 목록 |
| GET | `/sessions/:id` | 실행 상태 |
| POST | `/sessions/:id/stop` | 실행 중단 |
| GET | `/sessions/:id/events` | SSE 이벤트 |

실행 요청:

```
{
  "policyId": "policy-001",
  "instruction": "적정가보다 15% 저렴한 피카츄 카드를 찾아 구매해."
}
```

응답:

```
{
  "id": "session-001",
  "status": "RUNNING"
}
```

Agent Runtime은 사용자 인증·인가가 끝난 내부 요청만 수락합니다. 실행 수명은 서버가 관리하며 브라우저·SSE 연결 종료로 Agent 실행을 중단하지 않습니다. 재접속 시 기존 실행 상태를 조회합니다. 명시적 중단 시 대기 주문은 PAUSED, 미제출 예약은 원래 만료 시간까지 유지한 결제 보류, 제출된 결제는 정산·복구 계속입니다. 재개 시 최신 정책·예산을 재검증합니다. 실행 세션의 기한과 브라우저 연결 수명을 구분합니다.

응답 전체 필드는 `{ id, policyId, instruction, status, expiresAt, result }`이며 status는 RUNNING·STOPPED·COMPLETED·FAILED, result는 문자열 또는 null입니다. 같은 Agent의 동시 실행은 같은 정책을 공유합니다. 기한은 정책 만료와 시작 후 24시간 중 이른 시각입니다. SSE `status` 이벤트의 data는 현재 전체 실행 DTO이며 재접속하면 최신 스냅샷을 보냅니다. 과거 이벤트 재생은 제공하지 않습니다.

`executeAgentRun` 주입 시 서버가 작업을 실행하고 결과를 저장합니다. 호스트 재시작 시 RUNNING 작업을 재인계하며 단일 실행 호스트를 전제합니다. 기본 server.ts에는 실제 LLM 작업 실행기·지급 서명기가 연결되지 않았습니다. 기존 `/api/agent/sessions` 대화 플러그인은 별도 메모리 대화 API이며 Core API에 자동 등록하지 않습니다.

## 4. MCP Tool 계약

MCP Server는 아래 도구를 제공한다.

| Tool | 입력 | 반환 |
| --- | --- | --- |
| `search_cards` | `query`, `limit` | 카드 목록 |
| `get_valuation` | `cardVariantId` | 적정가 |
| `list_listings` | `cardVariantId`, `maxPrice?` | 활성 매물 |
| `get_listing` | `listingId` | 매물 상세 |
| `create_buy_order` | `cardVariantId`, `maxPrice`, `expiresAt` | BuyOrder |
| `list_buy_orders` | 없음 | 현재 Agent 주문 |
| `cancel_buy_order` | `buyOrderId` | 변경 상태 |
| `match_buy_order` | `buyOrderId` | MatchQuote 또는 미매칭 |
| `quote_fixed_purchase` | `listingId`, `maxPrice` | MatchQuote |
| `quote_market_purchase` | `cardVariantId`, `maxPrice` | MatchQuote 또는 미매칭 |
| `execute_purchase` | `matchQuoteId` | x402 요구 또는 결제·체결 결과 |
| `get_purchase_status` | `matchQuoteId` | 예약·결제·체결 상태 |

MCP 도구는 Agent의 인증된 사용자·지갑 컨텍스트를 기반으로 작동합니다. 생성 작업의 멱등 키는 서버 실행 계층이 생성·보관·전달하며 LLM 입력으로 생성·변경하지 않습니다. 통신 재시도는 같은 키, 새 주문·미매칭 후 새 시장 탐색은 새 키입니다. 생성·매칭 요청의 키는 HTTP `Idempotency-Key` 헤더로 전달합니다. 도구 인수로 키를 받지 않습니다. 서버의 `policies.actionKey(auth, runId, action, input)`는 실행별 작업 키를 영속화하고 `createServerMcpClient`가 재시도에 같은 키를 사용합니다. 새 탐색의 action 이름은 서버 실행기가 새로 부여합니다.

지정가·시장가 미매칭의 성공 data는 null입니다. 지정가는 주문을 유지하고 시장가는 해당 시도를 종료합니다. 특정 고정가 매물 불가는 LISTING_UNAVAILABLE, 가격 상한 초과는 PRICE_LIMIT_EXCEEDED, 정책·예산 위반은 각각 명시적 오류입니다.

`execute_purchase`는 LLM이 임의의 결제 수신자, 토큰 주소 또는 결제 금액을 입력하지 못하도록 한다. 결제 조건은 서버가 보관 중인 MatchQuote와 Payment 정책에서 결정한다.

### 4.1. 도구 결과 형태

일반 성공 결과:

```
{
  "ok": true,
  "data": {},
  "requestId": "req-001"
}
```

업무 오류 결과:

```
{
  "ok": false,
  "error": {
    "code": "LISTING_UNAVAILABLE",
    "message": "Listing is no longer available",
    "retryable": false
  }
}
```

x402 결제 요구는 일반 오류와 구분하여, 선택한 x402 MCP 전송 규격의 표준 필드에 맞게 반환한다.

x402 v2 MCP 전송은 [공식 규격](https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/mcp.md)을 따릅니다. 요구는 `isError: true`, 직접 PaymentRequired 객체를 `structuredContent`와 JSON `content`에 같은 값으로 제공합니다. 일반 `{ ok, data }` 래퍼 안에 넣지 않습니다. 서명 재호출은 동일 도구·인수와 `params._meta["x402/payment"] = PaymentPayload`를 사용합니다. 정산 성공 결과의 `_meta["x402/payment-response"]`에는 success·transaction·network를 제공합니다. 서명은 모델 인수가 아닙니다.

## 5. Payment 내부 계약

Payment는 외부에 임의 결제 실행 REST API를 공개하지 않는다. MCP의 결제 진입점과 내부 Service Interface를 기본 경로로 사용한다.

### 5.1. 공통 서비스 인터페이스

```ts
interface PaymentService {
  preparePayment(input: { matchQuoteId: string; agentId: string }, auth: TradingBuyer):
    Promise<{ id: string; matchQuoteId: string; requirements: PaymentRequirements }>;
  processSignedPayment(input: { matchQuoteId: string; agentId: string; paymentPayload: unknown }, auth: TradingBuyer): Promise<PurchaseStatus>;
  getPaymentStatus(matchQuoteId: string, auth: TradingBuyer): Promise<PurchaseStatus>;
}
```

`PaymentRequirements`와 `PaymentPayload`는 x402 v2 SDK 타입·스키마를 사용합니다. 발행 요구는 MatchQuote 금액·Base Sepolia USDC·서버 수납 주소에 결합합니다. 서명자는 호스트가 해당 사용자·Agent에 연결한 지갑이어야 합니다. 지급 서명 원문은 저장하지 않고 제출 승인에 payloadHash를 기록합니다.

### 5.2. 결제·거래 조회

```ts
type PurchaseStatus = {
  id: string; // MatchQuote ID
  paymentAttemptId: string | null;
  policyId: string | null;
  policyVersion: number | null;
  amount: string;
  quoteStatus: MatchQuote["status"];
  paymentStatus: "REQUIRED" | "PENDING" | "UNKNOWN" | "FAILED" | "SETTLED" | null;
  tradeStatus: "NOT_STARTED" | "FINALIZING" | "COMPLETED";
  holdReasons: string[];
  expiresAt: string;
  remainingMs: number;
  transactionHash: string | null;
  needsReview: boolean;
  retryPaymentAllowed: boolean;
};
```

`retryPaymentAllowed`는 최신 검사에서 미제출 예약에 결제 가능 조건이 갖춰졌는지 나타냅니다. UNKNOWN/PENDING/SETTLED/FAILED에 새 지급을 허용하지 않습니다. REQUIRED는 요구만 발행한 단계로 카드·예산 보호 경계가 아닙니다. 보류 사유는 표시용 문자열이며 코드 분기로 해석하지 않습니다. 기본 복구는 30초마다 수행하며 미확정·거래 반영 지연 5분부터 needsReview를 표시합니다. 시간이 지나도 보호는 해제하지 않습니다.

Payment는 동일 MatchQuote에 대한 결제 시도를 식별하고 중복 정산을 방지합니다. 마켓플레이스 서버가 최신 정책·예산·예약 유효성을 재검증하고 외부 정산 요청 직전에 결제 시도·예산 예약·카드 보호 상태·적용 정책 버전을 같은 DB 트랜잭션에 저장합니다. 그 제출 승인이 확정된 후 외부 정산 요청을 전송합니다. 정책 변경과 제출 승인은 서버 DB 확정 순서를 따릅니다.

UNKNOWN은 새 결제 시도·서명을 만들지 않고 카드·예산 예약을 유지합니다. 서버가 기존 증빙으로 조회·복구하며 프론트에는 “결제 확인 중”과 재결제 차단을 제공합니다. 시간 경과만으로 실패 처리하지 않습니다. 장기 미확정은 운영자 확인 대상으로 넘기되 결과 확정 전 보호를 유지합니다. FAILED는 정산 성공 가능성이 배제된 확정 실패입니다.

paymentStatus의 SETTLED는 지급 정산 성공만 뜻합니다. 거래 완료와 분리하여 조회하고, SETTLED 시 예산 예약액을 사용 완료액으로 전환합니다. 소유권 이전 전에는 “결제 완료 · 거래 처리 중”, 소유권 이전과 Trade 저장 후에만 “구매 완료”입니다. 복구는 추가 결제 없이 Trading 반영만 멱등 재시도합니다. PurchaseStatus는 결제와 거래를 별도 필드로 반환하며 정산 성공을 거래 완료로 취급하지 않습니다. 트랜잭션 해시가 없는 UNKNOWN은 운영 확인 대상으로 보호를 유지합니다.

## 6. Trading 내부 계약

```
interface TradingService {
  createListing(input: CreateListingInput): Promise<Listing>;

  listListings(
    input: ListListingsInput
  ): Promise<Listing[]>;

  createBuyOrder(
    input: CreateBuyOrderInput
  ): Promise<BuyOrder>;

  quoteFixedPurchase(
    input: FixedPurchaseInput
  ): Promise<MatchQuote>;

  quoteMarketPurchase(
    input: MarketPurchaseInput
  ): Promise<MatchQuote | null>;

  matchBuyOrder(
    input: MatchBuyOrderInput
  ): Promise<MatchQuote | null>;

  releaseQuote(
    quoteId: string,
    reason: string
  ): Promise<void>;

  finalizeTrade(input: {
    matchQuoteId: string;
    paymentAttemptId: string;
  }): Promise<Trade>;
}
```

`finalizeTrade`는 Payment의 정산 확정 증빙을 신뢰 가능한 서버 측 인터페이스로 확인한 뒤 실행한다.

동일 MatchQuote 반복 호출에도 Trade와 소유권 이전은 한 번만 생성되어야 합니다. 동일 InventoryItem UUID의 ownerId를 구매자로 바꾸고 AVAILABLE로 전환하며 Trade 저장과 같은 DB 트랜잭션에서 처리합니다. TRANSFERRED는 제거하고 이전 이력은 Trade로 보존합니다.

완료된 Trade의 가격을 판매자 모의 수익으로 집계하며, 지급 정산만 성공하고 거래가 미완료면 확정 수익에 포함하지 않습니다. 중복 재시도에 같은 Trade를 중복 집계하지 않습니다. 별도 출금 가능 잔액을 만들지 않고 “모의 판매 수익 · 출금 불가”로 표시합니다.

위 6절의 내부 Service 시그니처는 기존 인터페이스 초안입니다. 인증 주체·멱등 키를 주입하는 실제 공개 함수 인수 구조의 정규화는 별도 후속 계약 작업이며, 이 문서 개정으로 런타임 시그니처를 변경하지 않습니다.

## 7. Aggregator·Valuation 내부 계약

```
interface AggregatorService {
  searchCards(input: {
    query: string;
    limit: number;
  }): Promise<CardVariant[]>;

  getCardVariant(
    id: string
  ): Promise<CardVariant | null>;
}

interface ValuationService {
  getValuation(
    cardVariantId: string
  ): Promise<Valuation>;
}
```

MVP에서는 외부 API 연결 실패 시 Mock 데이터로 전체 시연을 수행할 수 있도록 데이터 제공자를 추상화한다.

외부 자료가 부족한 경우 신뢰도를 임의로 높이지 않는다.

## 8. Fastify Plugin 계약

백엔드 모듈은 다음 형태의 Plugin Factory를 공개한다.

```
type ModuleDependencies = {
  prisma: PrismaClient;
};

function createTradingPlugin(
  deps: ModuleDependencies
): FastifyPluginAsync;
```

구체적인 종속성은 각 모듈의 역할에 따라 추가한다.

```
const paymentPlugin = createPaymentPlugin({
  prisma,
  tradingService,
  facilitator,
  policyService,
});
```

위 코드는 등록 형태의 예시다. 실제 의존 방향과 초기화 순서는 통합 담당자가 확정한다.

플러그인은 자신의 `listen()`을 호출하지 않는다.

## 9. 상태 전이

### 9.1. Listing

```
ACTIVE → RESERVED → SOLD
    ↘ CANCELLED
RESERVED → ACTIVE     (결제 실패 확정 또는 예약 해제)
```

### 9.2. BuyOrder

```
ACTIVE → MATCH_PENDING → FILLED
   ↓          ↓
 PAUSED     PAUSED
   ↓
 ACTIVE

ACTIVE / PAUSED → CANCELLED / EXPIRED

MATCH_PENDING → PAUSED는 결제 미제출 주문 중지의 논리적 결과다.
기존 예약은 해제하지 않고 원래 expiresAt까지 결제를 보류한다.
예약 만료 해제가 중단된 주문을 자동 재개시키지 않는다.
결제 제출 승인 이후에는 Agent 중단으로 결제/복구 상태를 되돌리지 않는다.
```

### 9.3. MatchQuote

```
RESERVED
  → PAYMENT_PENDING
  → SETTLED
  → COMPLETED

RESERVED → RELEASED

PAYMENT_PENDING → RECONCILING
RECONCILING → SETTLED / RELEASED
```

결제 결과가 불명인 경우 확정 증빙 없이 RELEASED로 전환하지 않습니다. PAYMENT_PENDING의 보호 시작점은 외부 요청 전 제출 승인 DB 커밋입니다. 확정 실패의 예약 해제 경로도 허용하되 UNKNOWN·단순 시간 경과는 실패 증빙이 아닙니다.

정책 변경·Agent 중단으로 결제를 보류해도 미제출 예약은 RESERVED와 원래 expiresAt을 유지합니다. 보류는 예약 소유권 해제가 아니며 프론트에 사유와 잔여 시간을 표시합니다. 만료 시 해제합니다. 조회는 holdReasons·remainingMs를 제공합니다. 정책 수정으로 기존 예약을 자동 취소하지 않으며, 제출 직전 최신 정책을 다시 검사합니다.

## 10. 공통 오류 코드

| 코드 | 의미 |
| --- | --- |
| `VALIDATION_ERROR` | 입력 형식 오류 |
| `UNAUTHORIZED` | 인증 실패 |
| `FORBIDDEN` | 권한 부족 |
| `CARD_NOT_FOUND` | 카드 없음 |
| `LISTING_UNAVAILABLE` | 매물 구매 불가 |
| `PRICE_LIMIT_EXCEEDED` | 최대 가격 초과 |
| `ORDER_NOT_ACTIVE` | 주문 대기 상태 아님 |
| `IDEMPOTENCY_CONFLICT` | 같은 작업 키를 다른 인수에 재사용 |
| `TRADE_NOT_FOUND` | 거래 없음 |
| `INVENTORY_CONFLICT` | 카드 중복 예약·판매 |
| `BUDGET_EXCEEDED` | 승인 예산 초과 |
| `POLICY_VIOLATION` | Agent 정책 위반 |
| `POLICY_NOT_FOUND` | 정책 없음 |
| `PAYMENT_UNAVAILABLE` | 결제 제공자·연결 미설정 또는 일시 사용 불가 |
| `PAYMENT_REQUIRED` | x402 지급 필요 |
| `PAYMENT_FAILED` | 지급 실패 확정 |
| `PAYMENT_UNKNOWN` | 정산 결과 불명 |
| `QUOTE_EXPIRED` | 결제 견적 만료 |
| `INTERNAL_ERROR` | 내부 처리 오류 |

REST는 상황에 맞는 HTTP Status를 사용한다.

MCP는 성공·업무 오류·x402 결제 요구를 프로토콜에 적합하게 구분한다.

## 11. 보안 및 멱등성 계약

- 거래·결제 생성 요청에는 `Idempotency-Key` 또는 이에 상응하는 안정적인 요청 식별자를 사용한다.
- 동일한 요청 키와 동일한 인수는 동일 결과를 반환하도록 한다.
- 같은 키를 서로 다른 인수에 재사용하면 오류로 처리한다.
- DB에 카드별 활성 예약 중복 방지 제약을 둔다.
- 결제 대상은 MatchQuote ID, 금액, 네트워크, 토큰, 수신자에 결합한다.
- 실제 개인키와 지급 서명 원문을 일반 로그에 출력하지 않는다.
- 사용자와 Agent의 카드·주문·예산 접근은 인증 컨텍스트를 통해 제한한다.
- 결제 결과 불명 상태에서 새로운 지급 서명을 자동 생성하지 않는다.

## 12. 계약 변경 절차

1. 담당자가 변경 필요 항목을 제안한다.
2. 공통 `contracts` 변경 필요성을 검토한다.
3. 영향을 받는 담당자와 합의한다.
4. Contract 변경을 먼저 반영한다.
5. 각 모듈에서 계약 테스트를 통과한다.
6. Fastify 및 Agent 통합 테스트를 수행한다.

**담당자가 다른 모듈의 내부 구현에 맞춰 임의로 계약을 변경하지 않는 것을 원칙으로 한다.**
