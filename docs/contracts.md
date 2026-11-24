# 공통 계약 결정 사항

기준: 제공된 공통 API 계약서 v2.0 및 시스템 설계서 v2.1.

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
- 평가에는 제공자별 최신 검증 집계가를 최대 한 개 사용합니다. sampleSize는 집계 표본 수이며 실제 거래 건수가 아닙니다. 판매 희망가·추세가·미검증 판본을 실제 거래 가능 가격으로 보증하지 않습니다.
- `PRICE_DATA_SOURCE=mock`은 기존 평가를 유지하며 market은 DB 카드 조회가 필요합니다. 두 출처를 혼합하지 않고, 적합한 시장 표본이 없으면 INSUFFICIENT_DATA입니다.

Valuation의 추가 필드는 optional이고 기존 USDC·UUID·오류 코드와 거래 DTO는 유지했습니다. MCP·Trading·Payment 소비자는 확장 필드와 표본 수의 의미를 함께 검토해야 합니다. [수집·검증 명령과 제한](../packages/valuation/README.md)을 확인하세요.

Inventory·Listing·BuyOrder·MatchQuote·Trade의 기존 DTO를 유지한 Trading Service와 REST Plugin을 통합했습니다. 입력은 `@tcg/trading`의 Zod Schema로 검증하며 구매에는 인증된 userId·agentId가 필요합니다. 체결은 결제 시도 ID·예약 ID·통화·금액이 일치하는 서버 측 SETTLED 증빙을 요구합니다. SpendingPolicy는 Trading 실행 경계에서 검증하며 영속 정책 저장소·누적 예산 예약·차감과 Payment 영속 기록 및 SDK 종속 x402 연결은 후속 범위입니다. 경로와 결제 경계는 [Trading README](../packages/trading/README.md), [통합 가이드](trading-integration.md)를 참고하세요.


## 거래 계약 정합성 보정

- 공유 거래 입력은 `@tcg/contracts`에서 제공하며 시장가의 maxPrice는 필수입니다.
- 매물·주문·예약 생성은 Idempotency-Key를 요구합니다. 같은 인증 주체·작업·키의 동일 입력은 최초 응답을 반환하며 다른 입력은 IDEMPOTENCY_CONFLICT(409)입니다. 판매 매물은 사용자, 구매 요청은 사용자와 Agent에 결합합니다.
- 정식 예약 경로는 POST /api/purchases/fixed/quote, POST /api/purchases/market/quote입니다. 기존 /api/quotes/*와 DELETE 주문 취소는 호환 별칭으로 유지합니다.
- 매물·예약·주문·거래 응답은 공통 도메인 DTO의 id를 사용합니다. 외부 계약서의 listingId·matchQuoteId 응답 예시는 해당 DTO의 id로 정규화한 구현 결정이며, 첨부 원본 문서를 수정하거나 팀 합의가 끝났다고 의미하지 않습니다.
- 신규 예약·매칭·주문 재개는 검증된 활성 Agent와 사전 승인 정책을 요구하며 제공자 미주입은 거부합니다. 실제 예산 누적 사용액 예약·차감은 Payment 후속 범위입니다.
