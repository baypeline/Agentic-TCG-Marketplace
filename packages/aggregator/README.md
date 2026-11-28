# TCG Aggregator

호스트의 기본 검색은 `CATALOG_MODE=curated`입니다. `createPrismaCardAdapter`의 `curation` 옵션으로 HTTPS 이미지·필수 식별 정보·판본/상태·양수 가격이 있는 카드만 최대 12종 선별하고 실제 한국어판을 우선합니다. 선별과 정렬은 검색어·limit 적용 전에 수행합니다. 원본 검증은 `CATALOG_MODE=all`로 실행하며 직접 ID 조회·기존 거래 연결은 선별 여부와 별개로 유지합니다. [선별 기준과 현재 데이터](../../docs/catalog-selection.md)를 참고하세요.

`createAggregatorService({ adapter })`, `createMockCardAdapter()`, `createPrismaCardAdapter(prisma)`, `createTcgdexCardAdapter(options)`, `createAggregatorPlugin({ aggregatorService })`를 제공합니다. 모두 공통 `CardDataAdapter` 인터페이스로 교체합니다.

Plugin은 호스트에서 `/api` prefix로 등록합니다.

`createPrismaCardAdapter(prisma)`로 DB 조회를 주입할 수 있습니다. 이름 검색은 대소문자를 구분하지 않는 부분 일치이며 `%`, `_`, 역슬래시는 문자 그대로 검색합니다. 결과는 ID 순으로 정렬하고 limit를 적용합니다. 존재하지 않는 카드는 null이며 nullable imageUrl은 공통 DTO의 optional 필드로 정규화합니다. 공유 Prisma Client의 연결·종료는 호스트가 담당합니다.

루트에서 `pnpm --filter @tcg/aggregator test`와 `pnpm --filter @tcg/aggregator typecheck`로 검증합니다.

## TCGdex 외부 어댑터

첫 제공자는 [TCGdex REST API](https://tcgdex.dev/rest)이며 API 키 없이 영어·한국어 카탈로그를 조회합니다. 옵션 `language: 'en' | 'ko'`의 기본값은 `en`입니다. 카드 검색은 [검색 API](https://tcgdex.dev/rest/cards)와 [필터·페이지 설정](https://tcgdex.dev/rest/filtering-sorting-pagination)을 사용합니다. 검색 brief에 세트 정보가 없으므로 필요한 상세만 보충해 공통 DTO로 변환합니다. 시세 수집·환율 변환은 별도 단계입니다.

```typescript
import {
  createAggregatorService,
  createInMemoryCardIdentityStore,
  createTcgdexCardAdapter,
} from '@tcg/aggregator';

// 독립 시연용. 영구 저장 시 createPrismaCardIdentityStore(prisma)를 사용한다.
const identityStore = createInMemoryCardIdentityStore();
const adapter = createTcgdexCardAdapter({ identityStore });
const service = createAggregatorService({ adapter });
const [card] = await service.searchCards({ query: 'Pikachu', limit: 1 });
const detail = card ? await service.getCardVariant(card.id) : null;
```

### 정규화와 ID

- 내부 `id`는 UUID이며 공급자의 `base1-58` 같은 ID를 직접 노출하지 않습니다.
- `CardIdentityStore.getOrCreateId(reference)`와 `findById(id)`를 필수 의존성으로 주입합니다. reference는 provider, externalId, language, edition, condition을 포함합니다.
- `createInMemoryCardIdentityStore()`는 동일 인스턴스에서만 UUID를 보존하는 시연용 저장소입니다. 어댑터를 다시 만들어도 같은 저장소를 주입하면 매핑이 유지됩니다. 영구 저장은 아래 Prisma 매핑 저장소를 사용합니다. 매핑이 없는 내부 UUID는 외부 조회 없이 null을 반환합니다.
- `set.id`는 `setCode`, `localId`는 문자열 `cardNumber`, 언어는 선택한 카탈로그에 따라 `EN` 또는 `KO`로 정규화합니다. 이미지가 있으면 [공식 이미지 규칙](https://tcgdex.dev/assets)에 따라 `/high.webp`를 붙이고, 없으면 URL을 생성하지 않습니다. 한국어 이미지가 없을 때 영어판 이미지를 대신 연결하지 않습니다.
- 카탈로그는 개별 카드의 보존 상태를 알려주지 않으며 여러 인쇄 변형의 존재 여부만 제공합니다. `edition`과 `condition`은 `UNSPECIFIED`로 반환합니다. 일반판·홀로·초판이나 NM 상태로 임의 확정하지 않습니다. 이 결과는 검색용이며 거래 가능한 변형·상태를 확정하는 단계는 별도로 필요합니다.
- [Pocket 전용 `tcgp` 시리즈](https://tcgdex.dev/tcg-pocket)의 세트는 제외합니다. 한국어 경로에는 이 시리즈 메타데이터가 없어 제외 목록만 영어 경로에서 읽습니다. 카드 본문은 선택한 언어로 조회합니다. Pocket 카드나 검색 중 삭제된 카드가 섞이면 결과 수가 limit보다 적을 수 있으며 추가 페이지를 자동 순회하지 않습니다.
- 공급자의 `pricing` 등 추가 필드는 공통 DTO에 포함하지 않습니다. 실제 카드 정보를 가져오는 것과 실제 시장가격 평가는 별개입니다.

### 호출 제한과 실패 처리

- 요청당 기본 5초, 한 번의 검색/상세 작업에서 수행하는 외부 HTTP 조회는 기본 15초 제한입니다. ID 저장소의 응답 시간은 주입받은 구현이 관리합니다.
- 검색 limit는 1~100이며 첫 페이지를 ID 오름차순으로 요청합니다. 공급자가 더 많이 반환하더라도 후속 상세 조회는 limit 이하로 제한합니다.
- 상세 보충은 동시 최대 2건입니다. 상세 및 Pocket 세트 목록은 기본 60초 캐시를 사용하며 상세 캐시는 최대 200개입니다.
- `requestTimeoutMs`, `operationTimeoutMs`, `cacheTtlMs`, `fetch`, `now`를 주입할 수 있습니다. `cacheTtlMs: 0`은 캐시를 끕니다.
- 공급자 필터 구문인 `|`, `*`, `:`는 일반 검색어에서 거부하며, 나머지 검색어는 URLSearchParams로 인코딩합니다.
- 상세 404만 null입니다. 잘못된 응답·네트워크 오류·429·서버 오류를 빈 목록이나 Mock 성공으로 대체하지 않습니다. `TcgdexAdapterError`는 공통 `AppError`를 상속합니다.
- 내부 `reason`은 `TIMEOUT`, `RATE_LIMITED`, `NETWORK_ERROR`, `HTTP_ERROR`, `INVALID_RESPONSE`이며 HTTP 상태는 각각 504, 503, 502, 502, 502입니다. 공통 오류 코드는 기존 `INTERNAL_ERROR`를 사용합니다. 429의 Retry-After는 오류의 `retryAfterMs`로 보존합니다.
- 자동 재시도는 하지 않습니다. 호출자는 `retryable`과 `retryAfterMs`를 확인해 재호출을 결정합니다. 공급자 오류 본문이나 네트워크 진단 원문은 사용자 메시지에 노출하지 않습니다.

## 실제 API 확인

```powershell
pnpm --filter @tcg/aggregator check:external
```

키·DB 없이 검색 1건과 같은 UUID의 상세 조회를 확인합니다. 이 명령만 외부 네트워크에 의존하고, 기본 `test`는 주입한 fetch 응답으로 독립 실행합니다.

## PostgreSQL 영구 UUID 매핑

`createPrismaCardIdentityStore(prisma)`를 외부 어댑터에 주입하면 프로세스·Client·어댑터가 바뀌어도 같은 참조의 UUID를 재사용합니다.

```typescript
import { createPrismaCardIdentityStore, createTcgdexCardAdapter } from '@tcg/aggregator';

// prisma의 생성·연결·종료는 실행 호스트가 담당한다.
const adapter = createTcgdexCardAdapter({
  identityStore: createPrismaCardIdentityStore(prisma),
});
```

- 저장 테이블은 `catalog.ExternalCardIdentity`입니다. provider는 현재 TCGDEX만 지원합니다.
- `provider + externalId + language + edition + condition` 복합 유일성 제약으로 중복을 방지합니다. 언어·에디션·상태는 앞뒤 공백 제거와 대문자 변환으로 정규화하고, 외부 ID의 대소문자는 그대로 보존합니다. 메모리 저장소도 동일한 정규화 규칙을 사용합니다.
- 생성은 DB의 중복 무시 삽입 후 해당 참조의 UUID를 조회합니다. 두 Client의 동시 요청에서도 DB 유일성 제약을 통해 하나의 UUID로 수렴합니다. 기존 UUID를 갱신하거나 덮어쓰지 않습니다.
- 언어·에디션·상태가 다른 참조에는 별도 UUID를 발급합니다. 여러 제공자의 동일 실물 카드를 자동 병합하는 기능은 포함하지 않습니다.
- `findById()`는 저장된 외부 참조를 복원합니다. 없는 UUID 또는 잘못된 UUID는 null이며 새 매핑을 생성하지 않습니다. DB 장애는 메모리 매핑이나 새 UUID로 대체하지 않습니다.
- 매핑 저장소 자체는 UUID를 **예약**하며 카드 본문을 생성하지 않습니다. 실제 수집은 아래 Collection Service가 수행합니다. 수집된 `CardVariant.id`와 `externalIdentityId`는 같은 UUID이며, 후자는 매핑 테이블을 참조하는 FK입니다. DB CHECK 제약으로 두 UUID의 불일치를 방지합니다. 기존 Mock 카드는 nullable 연결을 통해 그대로 유지합니다.
- 외부 카드가 조회되지 않더라도 기존 매핑을 삭제하거나 다른 카드에 UUID를 재할당하지 않습니다.

실제 API와 DB 매핑을 확인하려면 Migration을 적용하고 다음 명령을 실행합니다. 루트 `.env`의 `DATABASE_URL`을 사용하며, 매핑 데이터는 DB에 남습니다. 같은 외부 카드가 반환되면 명령을 다시 실행해도 같은 UUID가 출력됩니다.

```powershell
pnpm db:migrate
pnpm --filter @tcg/aggregator check:external:db
```

`pnpm test:db`는 외부 네트워크 없이 독립 Client 동시 요청·재연결·역매핑·중복 방지와 외부 어댑터 재생성 시 상세 조회를 검증합니다. 테스트가 생성한 고유 외부 ID의 행만 정리합니다.

## 카드 수집·DB 저장·조회

수집은 CLI에서 명시적으로 실행합니다. Core API의 `CARD_DATA_SOURCE=database`는 이미 저장된 카드를 조회하며, 일반 검색·상세 요청 중에 외부 API를 호출하지 않습니다. 수집 쓰기용 공개 REST 엔드포인트는 제공하지 않습니다.

```powershell
pnpm db:migrate
pnpm cards:collect --query Pikachu --limit 5
```

기본 언어는 `en`, 검색어는 Pikachu, limit는 5이며 1~100까지 지정할 수 있습니다. 영어 모드에서는 한국어 사전을 채운 뒤 정확한 한국어 종명을 영어로 대응시켜 수집할 수 있습니다. 한국어 모드는 `pnpm cards:collect --language ko --query 로젤리아 --limit 5`처럼 원문 검색어를 그대로 전달합니다. 공급자의 첫 페이지만 조회하므로 전체 카탈로그 일괄 동기화 기능은 아닙니다. Pocket 제외·삭제 등으로 실제 저장 수는 limit보다 적을 수 있습니다. 루트 `.env`의 `DATABASE_URL`을 사용하며 비밀값을 출력하지 않습니다.

```typescript
import {
  createCardCollectionService,
  createPrismaCardCatalogWriter,
  createPrismaCardIdentityStore,
  createTcgdexCardAdapter,
} from '@tcg/aggregator';

const collector = createCardCollectionService({
  source: createTcgdexCardAdapter({ identityStore: createPrismaCardIdentityStore(prisma) }),
  writer: createPrismaCardCatalogWriter(prisma),
});
const result = await collector.collectCards({ query: 'Pikachu', limit: 5 });
// { items: CardVariant[], storedCount: number, collectedAt: UTC ISO 문자열 }
```

- 네트워크 조회와 정규화를 완료한 뒤 한 배치의 카드 본문을 DB 트랜잭션으로 저장합니다. 카드가 없으면 쓰기를 생략합니다. 유효하지 않거나 중복 UUID가 포함된 결과는 저장하지 않습니다.
- 매핑 UUID로 `CardVariant`를 생성·갱신하고 `lastCollectedAt`에 수집 완료 시각을 기록합니다. 출처는 `externalIdentity.provider`와 `externalId`로 역조회할 수 있습니다. 공통 DTO에는 내부 수집 메타데이터를 추가하지 않습니다.
- 같은 카드를 재수집해도 UUID와 카드 수가 바뀌지 않습니다. 이름·이미지는 갱신하며 이전 시각의 배치가 늦게 완료되면 최신 메타데이터를 유지합니다. `storedCount`는 신규 삽입 수가 아니라 배치에서 저장·확인한 카드 수입니다.
- 게임·세트·번호·언어·에디션·상태가 바뀌거나 같은 변형이 다른 UUID로 존재하면 실패합니다. 기존 UUID를 재할당하거나 거래 대상의 식별 속성을 조용히 바꾸지 않습니다.
- 동시 수집의 잠금 순서는 UUID 기준으로 맞추며 DB 제약으로 중복을 막습니다. 배치 중 하나라도 실패하면 그 배치의 본문 저장은 전부 롤백합니다. 외부 어댑터가 미리 예약한 UUID 매핑은 남을 수 있으며 다음 수집에서 재사용합니다.
- 외부 카드를 재수집하지 않았거나 조회에서 빠졌다는 이유로 기존 카드를 삭제하지 않습니다. 가격 표본이나 거래·보유 카드 데이터는 수정하지 않습니다.
- `CardCollectionError.reason`은 `INVALID_CARD`, `DUPLICATE_CARD`, `IDENTITY_NOT_FOUND`, `IDENTITY_MISMATCH`, `VARIANT_CONFLICT`로 구분합니다. 자동 재시도나 Mock 대체는 하지 않습니다.

수집 이후 API의 `.env`를 `DATABASE_ENABLED=true`, `CARD_DATA_SOURCE=database`로 설정하고 서버를 실행하면 다음 경로로 조회합니다. 주소는 루트 `.env`의 `CORE_API_URL`을 사용합니다.

```http
GET /api/cards?q=Pikachu&limit=20
GET /api/cards/<수집된 내부 UUID>
GET /api/cards/<수집된 내부 UUID>/valuation
```

가격 수집은 별도 단계입니다. 현재 외부 카드에 가격 표본이 없으면 평가 API는 `INSUFFICIENT_DATA`, `estimatedPrice: null`, `sampleSize: 0`을 반환합니다. 기존 시연용 가격 표본과 혼합하지 않습니다. 타 담당 모듈의 코드와 계약은 변경하지 않습니다.

## 세트 단위 수집과 재개

Migration을 적용한 뒤 루트에서 실행합니다. [TCGdex 세트 API](https://tcgdex.dev/rest/set)의 선택한 언어 카드 목록을 고정하고 최대 20장씩 나누어 저장합니다. 제공자 목록을 재정렬하며 넘기는 페이지 대신, 저장된 ID 목록의 위치를 체크포인트로 사용합니다.

```powershell
pnpm db:migrate
pnpm cards:collect:set --set base1
pnpm cards:collect:set --set base2
# 첫 배치까지만 저장한 뒤 다음 실행에서 이어가기
pnpm cards:collect:set --set base1 --batch-size 20 --max-batches 1
# 완료한 세트도 목록부터 명시적으로 다시 수집하기
pnpm cards:collect:set --set base1 --refresh
```

`createTcgdexSetSource(options)`는 `SetCardSource.getSet(setId)`와 `getCard(externalId, setId)`를 제공합니다. `createTcgdexCardAdapter()`도 `getCardByExternalId()`를 추가로 제공합니다. 기존 카드 검색·상세 인터페이스는 유지합니다. `createSetCollectionService({ prisma, source, language?, writer?, now? }).collectSet({ setId, batchSize?, maxBatches?, refresh?, onProgress? })`는 저장된 진행 지점부터 실행합니다. source와 collector에 같은 language를 주입합니다.

- `catalog.CatalogCollectionRun`에 세트·카탈로그 언어·고정 외부 ID 목록·nextIndex·상태·실행 잠금을 저장합니다. 다른 세트·언어는 독립된 작업입니다. 같은 외부 ID라도 언어가 다르면 UUID도 분리합니다.
- `batchSize`는 1~20, 기본 20입니다. `maxBatches`로 한 번에 처리할 배치를 제한할 수 있습니다. 네트워크는 동시에 최대 2건이며 상세 조회가 모두 성공한 후 배치를 DB에 저장합니다. 수집 네트워크 요청은 DB 트랜잭션 밖에서 수행합니다.
- 배치 저장 후에만 체크포인트를 전진시킵니다. 저장과 진행 기록 사이에 종료되면 같은 배치를 재실행할 수 있지만 영구 UUID와 DB 제약으로 카드가 중복되지는 않습니다.
- 같은 세트의 동시 실행은 409 오류로 거부합니다. 잠금은 5분이며 배치 전후에 갱신합니다. 정상 실패는 즉시 해제하고 프로세스 강제 종료 시 만료 후 재개할 수 있습니다. 이전 실행은 잠금 토큰이 바뀌면 저장을 중단합니다.
- 완료 작업의 기본 재실행은 외부 조회 없이 저장 0건을 반환합니다. `--refresh`만 새 목록을 받아 처음부터 갱신합니다. 제공자 목록에서 사라진 카드를 자동 삭제하지 않습니다.
- Pocket·다른 세트의 상세·중복 ID·빈 목록·상세 누락은 거부합니다. 잘못된 카드를 건너뛰어 전체 세트 수집이 끝난 것처럼 표시하지 않습니다. 외부 API 오류는 그대로 실패하며 재실행으로 복구합니다.
- 결과의 `storedThisRun`은 이번 실행에서 저장한 카드 수이며 신규 삽입 수와 다릅니다. 영어판의 한국어 표시 이름은 기존 종명 사전에서 연결합니다. 한국어판은 제공자의 원문 이름을 보존하고 종명 번역으로 덮어쓰지 않습니다. 에디션·상태는 UNSPECIFIED를 유지합니다. 가격 수집은 별도 명령입니다.

공유 샘플은 영어 171장과 한국어 239장의 총 410장입니다. 영어 자료는 Base Set(`base1`) 102장, Jungle(`base2`) 64장, 기존 프로모 피카츄 5종이며 종명 연결은 136장, 이미지 URL은 166장입니다.

### 한국어 카탈로그 수집

```powershell
pnpm cards:collect:set --language ko --set SV5K
pnpm cards:collect:set --language ko --set SV4K
pnpm cards:collect:set --language ko --set SV4M
pnpm fixtures:export
```

2026-11-22에 제공자 API가 반환한 한국어 카드 목록은 와일드포스(`SV5K`) 49장, 고대의 포효(`SV4K`) 95장, 미래의 일섬(`SV4M`) 95장입니다. 세트 메타데이터 95개 모두에 카드가 있는 것은 아닙니다. `COMPLETED`는 제공된 ID 목록의 처리가 끝났다는 뜻이며 실제 출시 세트 전체의 완전성을 보증하지 않습니다. 특히 SV5K의 선언된 카드 수와 제공 목록이 달라 목록 밖 카드를 추정 생성하지 않습니다.

239장 모두 원문 이름·세트·번호·외부 ID·내부 UUID를 저장했습니다. TCGdex 한국어 카탈로그 기준이며 공식 인쇄본과 모든 항목을 독립 대조한 자료는 아닙니다. 이미지가 제공되지 않아 비워 두었고 한국어판 가격도 가져오지 않았습니다. 공급자의 해외 가격 필드를 한국 국내 시세로 사용하지 않습니다. 가격 자료가 없으면 평가 API는 `INSUFFICIENT_DATA`입니다. 팀원은 `pnpm db:seed:collected`로 네트워크 없이 동일한 자료를 복원할 수 있습니다.

## 한국어 종명 사전과 카드 표시 이름

```powershell
pnpm cards:localize
pnpm cards:collect --query 피카츄 --limit 5
```

`createPokeApiNameProvider()`는 [PokéAPI의 언어별 종명 데이터](https://github.com/PokeAPI/pokeapi/blob/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv)와 같은 버전의 `languages.csv`를 읽습니다. revision은 `cd5f6c6232f23430aa6089896d96230f5f7ecef4`로 고정했습니다. 영어와 한국어가 모두 있는 1,025종의 이름을 연결하며 카드별·종별 개별 HTTP 요청을 반복하지 않습니다. 출처는 카드의 `localizedNames[].sourceUrl`에 보존합니다. 출처는 공개 PokéAPI 데이터이며 한국어판 카드 제목을 검증하는 공식 TCG 카드 DB는 아닙니다.

`createPokemonLocalizationService({ prisma, provider, now? }).importNames()`는 네트워크 검증 후 사전과 표시 이름을 DB 트랜잭션으로 저장합니다. 잘못된 CSV, 중복·모호한 종명, 누락된 언어 정의는 실패 처리하며 기존 자료를 삭제하거나 추정 번역으로 대체하지 않습니다. 사전은 반복 실행해도 중복되지 않으며 같은 버전·내용이면 importedAt도 유지합니다.

- `catalog.PokemonNameTranslation`: speciesId, 원문 영어 이름, 정규화 키, 한국어 종명, 출처, 가져온 시각.
- `catalog.CardLocalizedName`: 카드 UUID·표시 locale의 복합 키, 한국어 이름, 종명 FK, 출처.
- 공통 DTO는 기존 `name`과 인쇄 `language`를 유지하고 optional `localizedNames`를 추가합니다. 저장된 한국어 이름이 없으면 해당 필드는 생략합니다.
- NFKC·공백·대소문자 정규화 후 **원문 이름 전체가 일치할 때만** 연결합니다. `Pikachu V`, 소유자명·특수 형태·트레이너 이름 등을 추측해 번역하지 않습니다. 종명 표기와 한국어판의 실제 카드명은 다를 수 있습니다.
- 카드 수집 저장소는 입력 DTO의 임의 한국어 표기를 신뢰하지 않고 DB 사전에서 이름을 연결합니다. 원문명이 바뀌어 대응이 사라지면 이전의 자동 종명 표기도 제거합니다. 한국어판은 자동 종명 연결 대상에서 제외하고 원문 이름을 사용합니다. UUID·원문명·카드 인쇄 언어를 번역 때문에 변경하지 않습니다.
- DB 카드 검색은 원문명과 저장된 한국어 이름을 OR 조건으로 조회하고 나서 limit를 적용합니다. 일반 조회는 외부 이름 API를 호출하지 않습니다.
- Mock 어댑터도 fixtures에 포함된 피카츄·리자몽·이브이 표기로 검색할 수 있습니다. DB seed는 본문만 저장하므로 새 DB의 권장 순서는 `db:migrate` → `db:seed` → `cards:localize`입니다.
- Web은 한국어 표기를 우선 보여주고 원문 이름과 인쇄 언어를 함께 유지합니다. 화면 구조는 확장하지 않습니다.

사전 업데이트는 revision을 검토해 변경한 뒤 명령을 다시 실행합니다. 입력 스냅샷에 없는 기존 사전 행을 일괄 삭제하지 않습니다. 가격·거래·Agent 데이터는 변경하지 않습니다.
