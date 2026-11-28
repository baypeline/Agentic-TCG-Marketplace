# 공통 DB

`monetary-context.prisma`의 `market.MonetaryContext`는 거래 DB의 체인·통화·정밀도를 고정합니다. `ensureMonetaryContext`를 API 시작 및 시드에서 호출하며 기존 금액을 다른 통화로 재해석하지 않습니다. 마루는 별도 DB에 18자리 tOKRW 합성 시드를 구성하고 기존 USDC DB는 보존합니다. [초기화와 복귀](../../docs/maroo.md)를 참고하세요.

`TradingRequest`는 사용자·Agent·작업·요청 키에 결합한 입력 해시와 성공 응답을 보존합니다. Trading의 업무 변경과 같은 트랜잭션에 저장하므로 재시작·동시 재시도에도 같은 요청 결과를 반환합니다. 임의로 삭제하면 과거 요청의 중복 방지 보장이 사라집니다.

Prisma 7과 PostgreSQL driver adapter를 사용합니다. `createPrismaClient(databaseUrl)`은 Client를 생성하며 연결·종료는 호스트가 담당합니다. 최초 `pnpm install` 시 Client가 생성됩니다. Schema와 Migration은 `prisma/`에 있습니다. 타 담당 모델은 합의 후 추가합니다.

`trading.prisma`는 market의 InventoryItem·Listing과 trading의 BuyOrder·MatchQuote·Trade를 정의합니다. 거래 Migration은 중복 활성 매물·예약 및 중복 체결을 DB 제약으로 제한합니다. 로컬 시연 재고는 루트의 `pnpm trading:seed`로 추가하며 재실행해도 기존 재고 소유자와 상태를 유지합니다. [트레이딩 통합 가이드](../../docs/trading-integration.md)를 참고하세요.

Prisma 정의는 `prisma/schema/` 디렉터리를 하나의 스키마로 읽습니다. `base.prisma`는 공통 datasource·generator, `catalog.prisma`는 카드·가격 표본, `collection.prisma`는 Aggregator 세트 수집 상태를 정의합니다. 실제 PostgreSQL 스키마명, 테이블 및 Client 생성 위치는 기존과 동일하며 Migration은 계속 `prisma/migrations/`에서 공동 관리합니다.

루트에서 `pnpm db:generate`, `pnpm db:migrate`, `pnpm db:check`로 생성·마이그레이션·연결을 확인합니다. 기본 테스트는 DB 없이 실행되며 실제 통합 테스트는 `DATABASE_TEST_URL`을 설정합니다.

루트에서 `pnpm --filter @tcg/db test`와 `pnpm --filter @tcg/db typecheck`로 검증합니다.

`pnpm db:seed`는 공통 시연 fixtures의 카드 3개와 MOCK 가격 표본 6개를 고정 ID로 upsert합니다. `seedDemoCatalog(prisma)`도 공개합니다. `catalog.PriceObservation`에 가격, 데이터 구분, 출처 및 관측 시각을 보존합니다. 전체 DB 통합 검증은 루트 `pnpm test:db`로 실행합니다.

`pnpm db:seed:collected`는 Git의 [수집 데이터 JSON](fixtures/README.md)을 검증해 외부 API 없이 카드 410개(EN 171개·KO 239개)·종명 사전 1,025쌍·영어판 표시 이름 136개·영어판 참고 가격 1,145개를 삽입합니다. 한국어판은 원문 이름을 유지하며 이미지·가격을 임의 보충하지 않습니다. `readCatalogFixtures()`와 `seedCollectedCatalog(prisma, data)`를 공개합니다. 고정 UUID와 원본 시각을 유지하고 기존 행은 덮어쓰지 않습니다. 충돌 시 전체 트랜잭션을 롤백하며 Mock 표본·가격 검증 기록은 변경하지 않습니다. `pnpm fixtures:export`는 selection.json에 명시된 카드·세트·언어의 JSON과 해시를 갱신합니다.

실제 참고 시세는 `catalog.MarketPriceSnapshot`에 별도 저장합니다. 원본 금액·통화, 제공자 변형, 가격 유형, 외부 ID, 출처, 갱신·수집 시각을 보존하고 복합 유일 키로 중복을 막습니다. `catalog.MarketPriceAssessment`는 스냅샷별 판본 확인 속성·근거와 USDC 환율·시각·환산 금액을 보관합니다. 수집은 이 검증 기록을 만들지 않으며 Mock seed·가격과 분리됩니다. 두 테이블의 수집·조회·검증 서비스는 Valuation이 소유합니다.

`catalog.ExternalCardIdentity`는 외부 카드 참조와 내부 UUID를 영구 매핑합니다. 제공자·외부 ID·언어·에디션·상태의 복합 유일성 제약을 둡니다. 해당 모델도 `catalog.prisma`에서 관리하며, 현재 제공자는 TCGDEX입니다. 매핑 저장소 팩토리는 `@tcg/aggregator`의 `createPrismaCardIdentityStore(prisma)`입니다. 매핑만 생성하면 `CardVariant` 행이 자동 생성되지는 않습니다.

`pnpm cards:collect --query Pikachu --limit 5`는 외부 어댑터와 `createPrismaCardCatalogWriter(prisma)`를 연결해 카드 본문도 저장합니다. `CardVariant.externalIdentityId`는 매핑 테이블 FK이며 DB CHECK 제약으로 카드의 내부 UUID와 동일하게 유지합니다. `lastCollectedAt`은 수집 완료 시각입니다. 기존 시연 카드는 두 필드가 null이며 유지됩니다. 수집은 배치 단위 트랜잭션이며 조회는 기존 `createPrismaCardAdapter(prisma)`와 REST API를 사용합니다.

`pnpm cards:localize`는 `catalog.PokemonNameTranslation`에 PokéAPI의 영어·한국어 종명 사전을 저장하고 `catalog.CardLocalizedName`에 카드 표시 이름을 연결합니다. 카드 UUID와 locale이 복합 키이며, 카드 삭제 시 표시 이름만 함께 정리되고 종명 사전은 보존됩니다. 기존 카드의 원문명·인쇄 언어·UUID는 변경하지 않습니다. 새 DB는 `db:migrate` → `db:seed` → `cards:localize` 순서로 준비하세요. 실제 한국어판 TCG 카드 카탈로그와는 별개입니다.
