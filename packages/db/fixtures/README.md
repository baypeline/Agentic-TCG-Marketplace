# 팀 공통 수집 데이터

`catalog/official-images.json`은 원본 410종 스냅샷과 분리한 공식 한국어판 이미지 20종의 출처·검증 해시입니다. 이미지 파일은 저장하지 않습니다. `db:seed:collected`는 원본 복원 후 이 연결도 적용합니다. `demo/korean-scenarios.json`은 별도 UUID·NORMAL/NM 시연 속성·합성 가격·판매 재고를 정의하며 `demo:seed`에 포함됩니다. 기존 원본의 미확정 상태나 가격을 덮어쓰지 않습니다. [한국어판 이미지와 거래 시드](../../../docs/korean-card-images.md)를 참고하세요.

별도 `demo/scenarios.json`은 아래 수집 스냅샷과 구분한 합성 거래 데모입니다. `pnpm demo:seed`로 합성 카드·고정 MOCK 시세·재고·매물을 추가하며 원본 카드·시장 가격이나 기존 소유권은 수정하지 않습니다. 이 파일은 수집 manifest의 일부가 아니고, 로더가 별도 Schema로 검증합니다. [데모 실행 가이드](../../../docs/demo-scenarios.md)를 참고하세요.

외부 API 없이 동일한 카탈로그로 개발하기 위한 고정 스냅샷입니다. 합성 Mock이 아니라 **수집한 참고 자료**입니다. DB 접속 정보, 사용자·Agent·매물·거래·결제 데이터와 판본·환율 검증 기록은 포함하지 않습니다.

| 파일 | 내용 | 개수 |
| --- | --- | ---: |
| catalog/cards.json | 수집 카드, 내부 UUID, 수집 시각 | 410 |
| catalog/external-identities.json | 외부 카드 ID와 내부 UUID 매핑 | 410 |
| catalog/korean-names.json | 영어·한국어 종명 사전 / 카드 표시 이름 | 1,025 / 136 |
| market/price-snapshots.json | 카드·제공자·변형·유형별 최신 참고 가격 | 1,145 |
| manifest.json | 형식 버전·데이터 구분·파일 SHA-256 | 1 |

영어판 171장은 Base Set 102장, Jungle 64장과 기존 프로모 피카츄 5종입니다. 종명은 영어판 136장에 연결됐고 트레이너·에너지·정확히 대응되지 않은 이름은 원문으로 유지합니다. 영어판 166장에 이미지 URL이 있으며 이미지 파일은 포함하지 않습니다. 종명 사전 1,025개가 카드 1,025개를 뜻하지 않습니다. 가격 1,145개는 영어판의 EUR/USD 제공자 집계가·판매 희망가이며 한국어판 실거래가가 아닙니다. 관측 시각은 제공자 갱신 시각입니다.

한국어판 239장은 와일드포스(`SV5K`) 49장, 고대의 포효(`SV4K`) 95장, 미래의 일섬(`SV4M`) 95장입니다. 2026-11-22 TCGdex 한국어 API의 제공 목록을 수집했으며 실제 출시 세트 전체를 보장하지 않습니다. SV5K는 선언된 카드 수와 제공 목록이 다릅니다. 이름은 제공자의 한국어 원문이며 종명 번역으로 덮어쓰지 않습니다. 공식 인쇄본과 모든 항목을 독립 대조한 자료는 아닙니다. 이미지와 한국어판 가격은 없으며 영어판 자료로 대신 채우지 않습니다.

## 로컬 DB에 넣기

저장소 루트에서 실행합니다. `.env`가 이미 있으면 `env:init`은 생략하세요.

```powershell
pnpm install
pnpm env:init
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm db:seed:collected
```

`db:seed`는 기존 합성 카드 3개와 Mock 가격 6개를 준비하는 별도 명령입니다. `db:seed:collected`만으로도 수집 카드·외부 ID·한국어 사전·표시 이름·참고 가격을 저장할 수 있습니다. 두 명령 모두 외부 API를 호출하지 않습니다.

API에서 확인하려면 루트 `.env`에 `DATABASE_ENABLED=true`, `CARD_DATA_SOURCE=database`를 설정한 뒤 `pnpm dev`를 실행합니다.

```http
GET /api/cards?q=피카츄
GET /api/cards?q=로젤리아
GET /api/cards/7187e8ab-7f8f-4c50-9cf9-fb20ed2b97cd
GET /api/cards/044f4a6d-386b-4bbc-9eb1-046266917174
GET /api/cards/044f4a6d-386b-4bbc-9eb1-046266917174/prices
```

가격 출처의 기본값은 `PRICE_DATA_SOURCE=mock`입니다. `market`으로 바꿔도 미확정 판본·환율 자료를 추측해 가격을 만들지 않습니다. 현재 수집 카드의 edition/condition은 UNSPECIFIED이므로 시장 적정가는 자료 부족이 정상입니다. 오래된 fixture 가격은 유효기간에 따라 만료 상태로 표시됩니다.

## seed 보존 규칙

- 모든 JSON과 manifest를 검증한 뒤 하나의 DB 트랜잭션으로 삽입합니다. UUID, 외부 키, 종명 대응, 통화, 가격 시각과 중복 키를 검사합니다.
- 원본 UUID·sourceUrl·observedAt·collectedAt·importedAt을 유지합니다. seed 실행 시점으로 바꾸지 않습니다.
- 기존 행을 수정·삭제하지 않습니다. 기존 최신 이미지나 카드 수집 시각도 보존합니다. 재실행 시 삽입 수는 0이며 동시 실행은 DB 유일성 제약으로 중복을 방지합니다.
- 동일 외부 ID가 다른 UUID에 연결되어 있거나 동일 UUID의 가격·종명·식별 속성이 충돌하면 전체 삽입을 롤백합니다. 팀 공통 데이터는 가능하면 개별 수집 전에 seed하세요. 충돌한 UUID를 강제로 재매핑하지 않습니다.
- 기존 판본·환율 검증 기록은 추가·삭제·변경하지 않습니다. 신규 DB에는 그러한 기록이 생성되지 않습니다. Market 시세와 Mock 표본은 별도 테이블로 유지합니다.
- `.gitattributes`가 이 디렉터리의 줄바꿈을 LF로 고정해 Windows checkout에서도 해시가 동일합니다. 해시는 우발적 수정 검출용이며 서명은 아닙니다.

## 스냅샷 갱신

```powershell
pnpm cards:collect:set --set base1 --refresh
pnpm cards:collect:set --set base2 --refresh
pnpm cards:collect:set --language ko --set SV5K --refresh
pnpm cards:collect:set --language ko --set SV4K --refresh
pnpm cards:collect:set --language ko --set SV4M --refresh
pnpm prices:collect --limit 200
pnpm fixtures:export
git diff -- packages/db/fixtures
```

수집 명령은 네트워크를 사용하지만 export와 seed는 사용하지 않습니다. export는 `selection.json`의 기존 영어 카드 UUID와 명시한 세트·언어·예상 카드 수, 고정 PokéAPI revision의 사전만 읽습니다. 세트의 language는 `EN` 또는 `KO`이며 생략하면 `EN`입니다. 선택한 언어별 카드 수가 예상과 다르면 내보내지 않습니다. 예상 수는 검토한 제공 목록 기준이며 실제 세트 전체 카드 수를 뜻하지 않습니다. 미확정 판본의 TCGdex 카드만 대상이며 사용자 데이터가 섞이지 않도록 전체 DB 자동 덤프를 제공하지 않습니다. 공유 대상을 늘리려면 selection과 데이터 변경을 함께 검토하세요. 수집 진행 상태와 실행 잠금도 JSON에 포함하지 않습니다.

export는 일관된 DB 스냅샷을 읽고 키 순서와 원본 시각을 고정합니다. 같은 DB 상태에서 재실행하면 파일 내용과 해시가 같습니다. 신규 가격은 원래 갱신 시각을 유지하며 제공자·변형·가격 유형별 최신 한 행만 포함합니다. JSON을 직접 고친 뒤 해시만 바꾸는 방식보다 수집·검증 후 다시 내보내는 방식을 권장합니다.

## 출처와 고지

- 카드 메타데이터: [TCGdex cards-database](https://github.com/tcgdex/cards-database), [MIT 원문](https://github.com/tcgdex/cards-database/blob/master/LICENSE). 해당 고지를 `licenses/TCGdex-MIT.txt`에 보존했습니다. 이미지 파일은 포함하지 않습니다.
- 한국어 종명: [PokéAPI CSV](https://github.com/PokeAPI/pokeapi/blob/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv), revision `cd5f6c6232f23430aa6089896d96230f5f7ecef4`. 해당 프로젝트 고지를 `licenses/PokeAPI-BSD-3-Clause.txt`에 보존했습니다. Pokémon 및 캐릭터 이름의 상표 권리는 원 권리자에게 있습니다.
- 가격: [TCGdex pricing](https://tcgdex.dev/markets-prices)을 통해 수집한 Cardmarket/TCGplayer의 소규모 사실 정보입니다. 각 행의 sourceUrl과 원본 통화·시각을 보존합니다. TCGdex 저장소의 코드 라이선스를 제3자 가격·이미지의 포괄적 재배포 허가로 해석하지 않습니다. 프로젝트의 개발용 참고 스냅샷이며 최신 가격 피드나 원 제공자의 보증 자료가 아닙니다.
