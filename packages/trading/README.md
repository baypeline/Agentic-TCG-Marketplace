# Trading

정책 변경·Agent 중단 시 미제출 예약은 원래 TTL까지 유지하고 결제를 보류합니다. `getMatch`는 보류 사유와 서버 기준 잔여 시간을 반환합니다. 이전 소유권 이력은 Trade로 보존하며 재고 상태는 AVAILABLE·LISTED·RESERVED입니다.

원본: [BAY-TCG-Trading](https://github.com/chaedotxyz/BAY-TCG-Trading/tree/ed1e7b9d984567750514478d1478c86960b9f037/tcg-trading-engine/packages/trading), 기준 커밋 `ed1e7b9d984567750514478d1478c86960b9f037`. 현재 workspace의 공통 계약과 Prisma Client를 사용하도록 선별 이식했습니다.

인벤토리, 고정가 매물, 매수 지정가 주문, 카드 예약, 소유권 이전을 처리합니다. Service와 Fastify Plugin은 `@tcg/trading`에서 import합니다. 거래 DTO·오류는 `@tcg/contracts`를 사용합니다. 가격은 USDC 최소 단위의 정수 문자열입니다. 예를 들어 10 USDC는 `"10000000"`입니다.

## 실행과 통합

```sh
pnpm install
pnpm --filter @tcg/trading typecheck
pnpm --filter @tcg/trading build
pnpm --filter @tcg/trading test
```

`createMockTradingStore()`는 공용 시연 CardVariant 세 종의 카드 여섯 장을 `demoSellerId`에 배정합니다. PostgreSQL 모드는 `pnpm db:migrate` 후 `createPrismaTradingStore(prisma)`를 사용합니다. 로컬 DB 시연은 루트에서 `pnpm trading:seed`로 동일한 재고 여섯 장을 추가합니다. 재실행해도 기존 재고 소유자·상태는 변경하지 않습니다. 운영 인벤토리 등록 API는 아직 없습니다. DB 검증은 Migration을 적용한 테스트 DB의 연결 문자열을 `DATABASE_TEST_URL`에 지정한 뒤 Trading 테스트를 실행합니다.

Core API의 `createIntegrationPlugins`에서 아래처럼 등록할 수 있습니다. `requireAuth`는 호스트가 검증한 사용자와 Agent를 가져오는 콜백입니다. Agent·MCP에서도 동일한 Service와 DTO를 사용할 수 있습니다.

```ts
import {
  createMockTradingStore, createPrismaTradingStore, createTradingService, createTradingPlugin,
} from '@tcg/trading';

// buildApp의 createIntegrationPlugins 안에서 사용
const tradingService = createTradingService({
  store: prisma ? createPrismaTradingStore(prisma) : createMockTradingStore(),
  payment: paymentEvidenceReader,
  executionContext: trustedExecutionContextReader,
  valuationService,
});

return [async app => {
  await app.register(createTradingPlugin({ tradingService, requireAuth }), { prefix: '/api' });
}];
```

`trustedExecutionContextReader`는 인증 사용자·Agent 쌍의 현재 online 상태와 사전 승인 정책을 반환합니다. 미주입·오프라인·비활성·만료·카드 불허 정책은 신규 예약을 거부합니다. 건당/전체 승인 상한과 할인 조건을 검사하며 정책별 가용 예산도 검사하며 실제 예약·차감은 공유 저장소를 사용하는 Payment가 처리합니다. Core API 기본 조립은 `executionInTransaction: getPolicyExecutionContext`로 같은 트랜잭션에서 정책·실행을 읽습니다. 할인 조건은 MARKET 적정가로만 검증합니다. `paymentEvidenceReader`는 Payment 모듈 또는 테스트가 주입합니다. 조회와 예약만 시연할 때는 `payment`를 생략할 수 있습니다. Plugin은 호스트의 AppError·ZodError 처리와 Prisma 연결을 사용합니다.

| API (접두사 제외) | Service | 동작 |
| --- | --- | --- |
| GET /inventory | listInventory | 인증 사용자 소유 카드 조회 |
| GET /listings | listListings | 활성 매물 조회. 선택 쿼리 `cardVariantId` |
| GET /listings/:id | getListing | 매물 상세 |
| GET /listings/lowest/:id | findLowestListing | CardVariant 최저가 매물 한 건 또는 `null` |
| POST /listings | createListing | `inventoryItemId`, `price` |
| DELETE /listings/:id | cancelListing | 소유자 매물 취소 |
| GET /buy-orders | listBuyOrders | 인증 Agent의 주문 조회 |
| POST /buy-orders | createBuyOrder | `cardVariantId`, `maxPrice`, `expiresAt` |
| POST /buy-orders/:id/cancel | cancelBuyOrder | 대기 주문 취소 |
| POST /buy-orders/:id/pause | pauseBuyOrder | 미제출 예약 유지·결제 보류 및 주문 중지 |
| POST /buy-orders/:id/resume | resumeBuyOrder | 활성 Agent·정책 확인 후 재개 |
| POST /buy-orders/:id/match | matchBuyOrder | 가능하면 예약. 매물 부재·상한 초과 시 `null`을 반환하고 주문 유지 |
| POST /purchases/fixed/quote | quoteFixedPurchase | `listingId`와 `maxPrice`로 선택 매물 예약 |
| POST /purchases/market/quote | quoteMarketPurchase | `cardVariantId`와 필수 `maxPrice`로 최저가 예약 또는 `null` |
| DELETE /quotes/:id | releaseQuote | 구매자가 미결제 예약 해제 |
| GET /matches/:id | getMatch | 구매자·Agent의 예약 상태·holdReasons·remainingMs |
| GET /matches | listMatches | 현재 Agent 예약 목록 |
| GET /seller-proceeds | sellerProceeds | 완료 Trade 기반 모의 수익, withdrawable: false |
| GET /trades | listTrades | 인증 사용자의 매수·매도 내역 |
| GET /trades/:id | getTrade | 거래 당사자만 상세 조회 |

매칭은 가격, 등록 시각, ID 순으로 이루어지며 구매자 소유 매물을 제외합니다. 공통 입력 스키마는 `@tcg/contracts`에서 관리합니다. 기존 `/quotes/fixed`, `/quotes/market`, `DELETE /buy-orders/:id`는 호환 별칭이며 같은 검증을 적용합니다. 기본 예약 시간은 2분입니다. 조회·매칭 시 만료된 `RESERVED`를 정리합니다. 호스트에서 별도로 `expireReservations()`를 호출할 수도 있습니다. 한 번 해제된 매수 주문은 주문 만료 시각까지 재시도할 수 있습니다.

## 결제 완료와 재시도

1. 업무 Payment는 최신 정책 검증·예산 예약·적용 버전·PAYMENT_PENDING을 같은 DB 트랜잭션에 저장한 뒤 외부 정산을 진행합니다. `beginPayment`는 단독 Trading 테스트용 저수준 진입점이며 업무 Payment 제출 경로는 사용하지 않습니다. 이 시점부터 TTL이나 사용자 해제로 예약이 풀리지 않습니다.
2. Payment는 예약 ID, 시도 ID, 통화, 금액과 함께 정산 상태를 영속 저장합니다. Trading은 주입된 `PaymentEvidenceReader.getPaymentRecord()`로 해당 레코드를 확인합니다. `FAILED`는 이후 성공으로 전환될 수 없는 결제 실패에만 사용합니다.
3. `SETTLED`이면 `finalizeTrade(quoteId, paymentAttemptId)`를 호출합니다. 성공하면 카드가 구매자에게 이전되고 `AVAILABLE` 상태가 되며, 매물과 주문이 닫히고 Trade가 한 트랜잭션으로 기록됩니다.
4. 정산 뒤 DB 쓰기가 실패하면 Payment가 같은 두 ID로 `finalizeTrade`를 다시 호출합니다. 이미 성공한 재시도는 기존 Trade를 반환합니다. 확정 실패 시 `releaseFailedPayment(quoteId, paymentAttemptId)`를 호출합니다. `PENDING`과 `UNKNOWN` 동안 예약을 유지합니다.

결제 상태 변경과 체결 진입점은 서버 내부용입니다. 테스트에서는 메모리 결제 기록을 주입해 10 USDC 매물, 9 USDC 대기 주문, 8 USDC 매칭, 정산과 멱등 체결 흐름을 실행합니다.

## 요청 키와 실행 중단

매물·주문·고정가/시장가 예약 생성 및 지정가 매칭 REST는 `Idempotency-Key` 헤더를 필수로 받습니다. Service 호출의 세 번째 인수도 `{ idempotencyKey }`입니다. 같은 사용자·Agent·작업·키와 동일 입력은 최초 성공 DTO를 반환하며, 다른 입력은 `IDEMPOTENCY_CONFLICT`(409)입니다. 응답 유실 시 새 키를 만들지 말고 같은 키로 재시도하세요. 미매칭 `null`도 같은 요청 결과로 유지되므로 새로운 시장 탐색은 새 키로 요청합니다. 현재 상태는 조회 API로 확인하세요.

세션 호스트는 Agent를 오프라인으로 전환한 뒤 `pauseAgentOrders(auth)`를 호출합니다. ACTIVE와 미제출 예약이 있는 주문은 PAUSED가 되고 미제출 예약은 원래 TTL까지 유지됩니다. 만료 해제 후에도 PAUSED 주문을 자동 재개하지 않습니다. 이미 제출된 PAYMENT_PENDING 예약은 유지하며 정산 복구는 온라인 상태와 관계없이 가능합니다. 조회·취소·해제는 실행 정책 없이도 소유권 검증 후 허용합니다. 이 모듈은 세션 상태 자체를 소유하지 않습니다.

REST 응답은 공통 도메인 DTO의 `id`를 정식 식별자로 사용합니다. 기존 문서 예시의 `listingId`·`matchQuoteId`는 각각 Listing.id·MatchQuote.id를 가리키며 응답 필드 별칭으로 중복 제공하지 않습니다.
