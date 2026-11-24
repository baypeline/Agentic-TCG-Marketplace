# Valuation

`createValuationService({ aggregatorService, adapter, now? })`, `createMockPriceAdapter()`, `createValuationPlugin({ valuationService })`를 제공합니다.

BigInt 중앙값을 사용하며 신뢰 수준은 LOW로 유지합니다. 자료가 없으면 `INSUFFICIENT_DATA`와 null 가격을 반환합니다. Mock은 `dataSource`로 구분합니다. 실제 참고 시세 수집과 검증 표본의 평가는 아래 경로로 분리합니다.

`createPrismaMockPriceAdapter(prisma)`는 DB의 MOCK 표본만 조회합니다. MARKET 표본과 혼합하지 않습니다. 모든 가격 표본은 `amount`, `source`, `observedAt`를 제공해야 합니다. 잘못된 가격·빈 출처·미래 관측 시각은 제공자 오류로 처리합니다. `evaluatedAt`은 계산 시점이며 시세의 최신성을 보장하지 않습니다. 상세 검증 규칙은 루트 `docs/contracts.md`를 확인하세요.

루트에서 `pnpm --filter @tcg/valuation test`와 `pnpm --filter @tcg/valuation typecheck`로 검증합니다.

## 외부 참고 시세 수집

```powershell
pnpm db:migrate
pnpm prices:collect --limit 20
# 특정 카드만 수집할 때
pnpm prices:collect --card-id <내부-카드-UUID>
```

`createTcgdexPriceProvider({ fetch?, timeoutMs?, now? })`는 [TCGdex pricing](https://tcgdex.dev/markets-prices)의 Cardmarket(EUR)와 TCGplayer(USD)를 읽습니다. 영어 외부 ID가 연결된 저장 카드만 지원합니다. 카드당 HTTP 한 번, 기본 5초 timeout, 본문 1MB 제한, 자동 재시도 없음. `--limit`는 1~500이며 기본 20개를 UUID 순으로 순차 수집합니다. 현재 공유 카드 171개는 `--limit 200`으로 모두 조회할 수 있습니다. 전체 카탈로그 동기화 명령이 아닙니다. 카드별 저장은 원자적이며 중간 카드가 실패하면 앞서 완료한 카드의 결과는 유지됩니다.

`createMarketPriceServices({ prisma, provider?, now?, maxAgeHours?, fxMaxAgeHours? })`가 `collectPrices(id)`, `assessPrice(input)`, `marketPriceService`, `adapter`를 반환합니다. `adapter`는 기존 `PriceDataAdapter`이며 조회 도중 외부 API를 호출하지 않습니다.

- `catalog.MarketPriceSnapshot`: 원본 통화·금액, 제공자, 외부 ID, 제공자 변형, 가격 유형, 출처 URL, 제공자 갱신 시각(`observedAt`), 수집 시각. 관측 시각은 개별 거래의 체결 시각이 아닙니다.
- 가격 유형은 `ASKING_LOW`(최저 판매 희망가), `PROVIDER_MARKET`(제공자 시장 집계), `PROVIDER_AVERAGE`(제공자 평균), `PROVIDER_TREND`(추세)입니다. 실제 개별 체결가를 수집한 것으로 표시하지 않습니다. 서로 겹치는 avg1/7/30을 별도 표본으로 늘리지 않습니다.
- 동일 카드·제공자·변형·가격 유형·갱신 시각은 한 번 저장합니다. 재수집 시 제공자 갱신 시각이 달라지면 새 이력입니다. 동일 키에 다른 가격이 오면 해당 카드 배치를 롤백합니다. 기존 검증 기록을 조용히 변경하지 않습니다.
- 누락·null·0 가격은 제외합니다. 음수, 비정상 통화, 미래 시각, 소수 6자리 초과 등 잘못된 제공자 응답은 오류입니다. 404·429·timeout을 빈 결과나 Mock 성공으로 바꾸지 않습니다.
- [TCGdex의 판본 매핑 한계](https://tcgdex.dev/faq)를 고려해 자동 수집은 검증 기록을 생성하지 않습니다. 가격에 한국어 표시 이름이 붙었다고 한국어판 가격이 되는 것은 아닙니다.

## 판본과 환율 검증

`catalog.MarketPriceAssessment`는 운영자가 **실제 근거를 확인한 뒤** 남기는 기록입니다. 수집 CLI나 공개 API는 검증을 자동 수행하지 않습니다. `UNSPECIFIED` 속성은 승인할 수 없으며, 거래 대상 카드 속성을 임의 변경해 통과시키면 안 됩니다.

```powershell
pnpm prices:assess --file C:/absolute/path/assessment.json
```

JSON 한 개의 구조는 다음과 같습니다. 자리표시자는 실제 저장된 스냅샷 ID·확인한 속성·실측 환율·근거로 바꾸세요. 예시 환율을 제공하지 않으며 USD와 USDC의 1:1 환산을 가정하지 않습니다.

```json
{
  "snapshotId": "저장된-가격-스냅샷-UUID",
  "language": "확인한 인쇄 언어",
  "edition": "확인한 에디션",
  "condition": "확인한 보존 상태",
  "matchEvidenceUrl": "https://검증한-판본-근거",
  "fxRate": "원본 통화 1단위당 USDC의 양수 소수 문자열",
  "fxSourceUrl": "https://검증한-환율-근거",
  "fxObservedAt": "환율 관측 UTC ISO 시각"
}
```

이 CLI는 DB 접근 권한이 있는 운영자를 신뢰합니다. URL의 내용과 판본 일치 여부를 자동 검증하는 도구는 아닙니다. 속성 일치, 미확정 속성 배제, 시간 유효성, 양수 가격은 코드로 검증합니다. 기존 검증을 다시 실행하면 해당 스냅샷의 검증 기록을 갱신합니다. 일반 사용자의 승인 REST는 제공하지 않습니다.

환산은 `floor(원본금액 × USDC환율 × 10^6)`을 BigInt 고정 소수 연산으로 수행합니다. 반올림이나 float 환산을 하지 않습니다. 환율은 소수 6자리까지 지원하며 검증 시각과 출처를 저장합니다.

## 평가와 조회

데모 프로젝트의 기본 API 정책은 `MARKET_VALUATION_MODE=demo`입니다. `PRICE_DATA_SOURCE=market`에서 `demoAdapter`를 사용해 TCGplayer의 최신 USD 시장 집계가를 **1 USD ≈ 1 USDC**로 표시합니다. 실제 수집 가격이므로 `dataSource=MARKET`이며 합성 Mock이 아닙니다. `methodology=DEMO_USD_REFERENCE`, `assumptions`에 환산과 판본·보존 상태 미보정 조건을 명시합니다. 일반판(normal), unlimited, holofoil, unlimited-holofoil, reverse-holofoil, 1st-edition, 1st-edition-holofoil 순서로 존재하는 대표 가격 하나를 선택하며 판본별 금액을 평균내지 않습니다. 최근 72시간의 양수 가격만 사용하고 EUR·판매 희망가·추세 가격은 대체 표본으로 쓰지 않습니다.

`MARKET_VALUATION_MODE=strict`는 기존 `adapter`의 판본·상태·환율 검증 규칙을 그대로 사용합니다. 이 라이브러리의 `adapter`를 직접 주입한 기존 소비자도 기존 동작을 유지합니다. `/prices`의 eligibility와 assessment는 항상 strict 기준이며 데모 환산은 승인 기록이나 카드 속성을 변경하지 않습니다. 아래 상세 평가 규칙은 strict 모드 기준입니다. `prices:check`의 `cardsWithDemoPrices`와 카드별 `demoPrices`는 데모 사용 가능 상태, `cardsWithEligiblePrices`와 `eligibleProviders`는 strict 상태입니다.

`pnpm prices:check`는 저장된 영어 TCGdex 카드의 최신 참고 가격과 평가 사용 가능 상태를 읽기 전용으로 확인합니다. 기본 최대 200장이고 `--limit 1~500`, `--card-id <UUID>`, `--file <절대경로.json>`을 지원합니다. 보고서는 카드별 미확정 속성, 제외 사유별 가격 수와 평가 가능한 제공자 수를 포함합니다. 수집·판본 승인·환율 변경은 하지 않으며, 성공 종료는 사용 가능한 적정가가 있다는 뜻이 아닙니다. `--file`을 생략하면 전체 JSON을 출력합니다.

2026년 11월 24일 재수집 결과와 아직 승인할 수 없는 이유는 [가격 데이터 점검 기록](../../docs/market-price-readiness.md)에 정리했습니다.

루트 `.env`에 `DATABASE_ENABLED=true`, `CARD_DATA_SOURCE=database`, `PRICE_DATA_SOURCE=market`를 지정하고 API를 재시작합니다. 기본 `PRICE_DATA_SOURCE=mock`은 기존 데모를 유지합니다. 실행 환경의 `DATA_MODE=mock`과 가격 출처 설정은 독립이며 `/health.priceDataSource`로 가격 모드를 확인합니다.

- `GET /api/cards/:id/prices`: 최신 참고 가격과 원본 통화, 유형, 시각, 검증/환율 근거 및 사용 가능 상태. Mock 가격 모드에서도 저장된 참고 시세를 조회할 수 있습니다. Mock 카드 모드는 빈 배열입니다.
- `GET /api/cards/:id/valuation`: 선택된 가격 모드로 평가합니다. 실제 모드에서는 가격 72시간, 환율 24시간 이내의 검증 표본만 사용합니다. 현시점 이전이어야 하며 경계 시각은 포함합니다.
- 카드 언어·에디션·상태가 검증 기록과 다르면 제외합니다. 검증되지 않은 최신 스냅샷을 이전 승인으로 대체하지 않습니다.
- Cardmarket `PROVIDER_AVERAGE`, TCGplayer `PROVIDER_MARKET`만 평가에 사용합니다. 최저 판매 희망가와 추세 가격은 참고 전용입니다.
- 조회는 카드별 최신 이력 1,000행에서 제공자·변형·가격 유형별 최신 스냅샷을 선택합니다. 이후 제공자별 최대 한 개를 사용해 동일 제공자 이력·변형이 표본 수를 부풀리지 않게 합니다. 매우 많은 이력의 장기 보관·정리 작업은 별도 범위입니다.
- `sampleSize`는 제공자 집계 표본 수이며 실제 체결 건수가 아닙니다. `methodology=MEDIAN_OF_PROVIDER_AGGREGATES`, `oldestObservedAt`, `latestObservedAt`을 제공합니다. 신뢰 수준은 항상 LOW입니다. 적합한 표본이 없으면 null 가격이며 Mock을 섞지 않습니다.

현재 자동 수집 카드의 에디션·상태는 `UNSPECIFIED`입니다. 참고 시세는 볼 수 있지만 속성이 실제로 확정되기 전 USDC 적정가를 제공하지 않는 것이 정상입니다. 판본 확정 절차와 자동 환율 제공자는 후속 확장입니다.

`pnpm test:db`는 동시 수집·중복 방지·가격 충돌 롤백·환산 정밀도·표본/환율 만료·잘못된 속성 배제와 REST 연결을 실제 PostgreSQL에서 검증합니다. 외부 API는 기본 테스트에서 호출하지 않습니다.
