# Trading

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
});

return [async app => {
  await app.register(createTradingPlugin({ tradingService, requireAuth }), { prefix: '/api' });
}];
```

`paymentEvidenceReader`는 Payment 모듈 또는 테스트가 주입합니다. 조회와 예약만 시연할 때는 `payment`를 생략할 수 있습니다. Plugin은 호스트의 AppError·ZodError 처리와 Prisma 연결을 사용합니다.

| API (접두사 제외) | Service | 동작 |
| --- | --- | --- |
| GET /inventory | listInventory | 인증 사용자 소유 카드 조회 |
| GET /listings | listListings | 활성 매물 조회. 선택 쿼리 `cardVariantId` |
| GET /listings/lowest/:id | findLowestListing | CardVariant 최저가 매물 한 건 또는 `null` |
| POST /listings | createListing | `inventoryItemId`, `price` |
| DELETE /listings/:id | cancelListing | 소유자 매물 취소 |
| GET /buy-orders | listBuyOrders | 인증 Agent의 주문 조회 |
| POST /buy-orders | createBuyOrder | `cardVariantId`, `maxPrice`, `expiresAt` |
| DELETE /buy-orders/:id | cancelBuyOrder | 대기 주문 취소 |
| POST /buy-orders/:id/match | matchBuyOrder | 가능하면 예약. 매물 부재·상한 초과 시 `null`을 반환하고 주문 유지 |
| POST /quotes/fixed | quoteFixedPurchase | `listingId`와 `maxPrice`로 선택 매물 예약 |
| POST /quotes/market | quoteMarketPurchase | `cardVariantId`와 선택 `maxPrice`로 최저가 예약 또는 `null` |
| DELETE /quotes/:id | releaseQuote | 구매자가 미결제 예약 해제 |

매칭은 가격, 등록 시각, ID 순으로 이루어지며 구매자 소유 매물을 제외합니다. 이 서비스가 제안하는 요청 필드 및 REST 경로는 팀 통합 인터페이스에 등록할 때 확인합니다. 기본 예약 시간은 2분입니다. 조회·매칭 시 만료된 `RESERVED`를 정리합니다. 호스트에서 별도로 `expireReservations()`를 호출할 수도 있습니다. 한 번 해제된 매수 주문은 주문 만료 시각까지 재시도할 수 있습니다.

## 결제 완료와 재시도

1. Payment는 결제 시도 ID를 발급하고 서버 내부에서 `beginPayment(quoteId, paymentAttemptId)`가 성공한 뒤 정산을 진행합니다. 이 시점부터 TTL이나 사용자 해제로 예약이 풀리지 않습니다.
2. Payment는 예약 ID, 시도 ID, 통화, 금액과 함께 정산 상태를 영속 저장합니다. Trading은 주입된 `PaymentEvidenceReader.getPaymentRecord()`로 해당 레코드를 확인합니다. `FAILED`는 이후 성공으로 전환될 수 없는 결제 실패에만 사용합니다.
3. `SETTLED`이면 `finalizeTrade(quoteId, paymentAttemptId)`를 호출합니다. 성공하면 카드가 구매자에게 이전되고 `AVAILABLE` 상태가 되며, 매물과 주문이 닫히고 Trade가 한 트랜잭션으로 기록됩니다.
4. 정산 뒤 DB 쓰기가 실패하면 Payment가 같은 두 ID로 `finalizeTrade`를 다시 호출합니다. 이미 성공한 재시도는 기존 Trade를 반환합니다. 확정 실패 시 `releaseFailedPayment(quoteId, paymentAttemptId)`를 호출합니다. `PENDING`과 `UNKNOWN` 동안 예약을 유지합니다.

결제 상태 변경과 체결 진입점은 서버 내부용입니다. 테스트에서는 메모리 결제 기록을 주입해 10 USDC 매물, 9 USDC 대기 주문, 8 USDC 매칭, 정산과 멱등 체결 흐름을 실행합니다.
