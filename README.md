# Agentic TCG Marketplace

AI Agent × MCP × x402 기반 TCG 거래 PoC의 개발 시작용 모노레포입니다.
카드 조회 API와 Agent 조회 런타임의 실행 기반을 제공합니다.

## 빠른 시작

Node.js 24 LTS, pnpm 12.9.1이 필요합니다. 아래 명령은 저장소 루트에서 실행합니다.

```powershell
pnpm env:init
pnpm install
pnpm dev
```

- Web: `http://127.0.0.1:<PORT>`
- Core API: `http://127.0.0.1:<API_PORT>/health`
- 검색: `<CORE_API_URL>/api/cards?q=pika&limit=10`
- 적정가: `<CORE_API_URL>/api/cards/00000000-0000-4000-8000-000000000001/valuation`

`pnpm env:init`은 루트 `.env`에 암호학적 난수 기반 DB 비밀번호와 계정·DB 이름, 사용 가능한 서로 다른 임의 포트를 생성합니다. 생성 결과에는 접속 포트만 표시하며 비밀값은 표시하지 않습니다. 기존 `.env`는 덮어쓰지 않습니다. 이미 생성한 경우 이 단계는 생략하세요. 수동 구성은 `.env.example`을 참고합니다. Web은 `PORT`, API는 `API_PORT`, Compose의 DB 공개 포트는 `POSTGRES_PORT`를 사용하며 `CORE_API_URL`과 `DATABASE_URL`도 일치해야 합니다.

Mock 모드는 외부 API 키·PostgreSQL·체인 연결 없이 실행됩니다. `pnpm install`의 postinstall이 Prisma Client를 생성합니다. `.env`는 커밋하지 않습니다.

## 디렉터리

```text
apps/
  web/                 Next.js 16 / React 19, 서버 측 API 조회
  api/                 Fastify 5 통합 호스트
  agent/               최재민 Agent Runtime, 카드 검색·Mock 적정가 조회
packages/
  aggregator/          카드 데이터 어댑터, Service, REST Plugin
  valuation/           가격 어댑터, 기본 중앙값 평가, REST Plugin
  contracts/           공통 DTO, Zod v4 Schema, 오류 코드
  db/                  Prisma 7 Client, Schema, Migration
  config/              환경변수 검증, 공통 TypeScript 설정
  trading/             [예약] 이채영
  mcp-server/          [예약] 김민지
  mcp-client/          [예약] 김민지
  payment-server/      [예약] 최승원
  payment-client/      [예약] 최승원
infra/                 PostgreSQL Docker Compose
research/              이재환 연구·실험
docs/                  통합 규칙 및 계약 결정 사항
```

예약 패키지는 `src/index.ts`와 README만 제공하며 업무 로직·실행·테스트가 아직 없습니다.

## PostgreSQL 연결

Docker Engine을 실행한 뒤 다음 명령을 사용합니다.

```powershell
pnpm infra:up
pnpm db:migrate
pnpm db:seed
pnpm db:check
```

API에서도 연결하려면 루트 `.env`의 `DATABASE_ENABLED=true`로 변경하고 서버를 재시작합니다. 활성화 시 연결 실패는 서버 부팅 실패로 처리합니다.

카드·가격 표본의 저장 위치는 `CARD_DATA_SOURCE=mock|database`로 선택합니다. `mock`은 메모리 어댑터이며 DB가 필요 없습니다. `database`는 DB 연결을 요구하며 PostgreSQL에서 검색·상세·가격 표본을 조회합니다. DB 장애 시 메모리 Mock으로 조용히 대체하지 않습니다. `/health`의 `cardDataSource`로 활성 어댑터를 확인할 수 있습니다.

`pnpm db:seed`는 고정 UUID의 시연 카드 3개와 `MOCK` 가격 표본 6개를 트랜잭션으로 upsert합니다. 반복 실행해도 중복되지 않으며 다른 ID의 데이터는 삭제하지 않습니다. 가격 출처는 `PRICE_DATA_SOURCE=mock|market`로 별도 선택하며 기본값은 mock입니다. DB에서 읽었다고 실제 시장가격이 되지 않습니다. `DATA_MODE=mock`은 기존 데모 실행 환경 구분으로 유지합니다.

목록에서 카드 이름을 선택하면 `/cards/:id` 상세 화면으로 이동합니다. 카드 속성과 가격·표본 수·신뢰 수준·출처·평가 시각을 확인할 수 있습니다.

## 한국어 이름 채우기

팀원이 외부 API 없이 동일한 데이터로 시작하려면 Migration 후 `pnpm db:seed:collected`를 실행하세요. Git에 포함된 카드 410개(EN 171개·KO 239개)·한국어 종명 사전 1,025쌍·영어판 표시 이름 136개·영어판 참고 가격 1,145개를 원래 UUID와 시각으로 로컬 DB에 넣습니다. 한국어판은 원문 이름을 보존하며 이미지·가격 자료는 없습니다. 기존 Mock seed는 별도이며 기존 데이터는 덮어쓰지 않습니다. [팀 공통 데이터 가이드](packages/db/fixtures/README.md)에 초기 설정과 갱신 절차를 정리했습니다.

```powershell
pnpm cards:localize
```

Migration과 seed 적용 후 실행합니다. PokéAPI의 버전 고정 데이터에서 영어·한국어 종명 1,025쌍을 가져와 사전에 저장하고, 기존 카드의 원문명과 정확히 대응하는 한국어 표시 이름을 연결합니다. 재실행해도 중복되지 않습니다. 카드 인쇄 언어·UUID·원문명은 유지하며, 검색 API는 한국어와 영어 이름을 모두 지원합니다. 예: `/api/cards?q=피카츄&limit=20`.

이는 포켓몬 **종명** 번역입니다. 한국어판 카드별 정식 제목이나 한국어 인쇄 카드 전체를 수집하는 기능은 아닙니다. 장식명·트레이너 카드·불명확한 대응은 원문명으로 표시합니다. DB 없이 실행하는 Mock 데모에도 피카츄·리자몽·이브이 표기를 제공합니다.

## 외부 카드 수집

```powershell
pnpm cards:collect --query Pikachu --limit 5
# 한국어 사전을 채운 뒤에는 정확한 한국어 종명도 사용 가능합니다.
pnpm cards:collect --query 피카츄 --limit 5
```

Migration 적용 후 실행합니다. TCGdex 영어 카탈로그에서 최대 5개를 조회하고, 영구 매핑된 내부 UUID로 DB에 저장한 뒤 조회까지 확인합니다. 기본 limit는 5, 허용 범위는 1~100이며 첫 페이지만 수집합니다. 재실행해도 중복 카드가 생성되지 않습니다. API가 `CARD_DATA_SOURCE=database`이면 기존 `/api/cards`, `/api/cards/:id`에서 저장된 외부 카드도 조회됩니다. 일반 조회는 외부 API를 호출하지 않습니다. 수집 카드의 상태·에디션은 UNSPECIFIED이며, 가격 표본은 별도로 수집해야 합니다. 상세 규칙은 [Aggregator 가이드](packages/aggregator/README.md)를 확인하세요.

## 세트 단위 카드 수집

세트 전체를 수집하려면 `pnpm cards:collect:set --set base1` 또는 `--set base2`를 사용합니다. 기본 20장씩 저장하고 중단·실패 시 DB 체크포인트부터 재개합니다. 완료된 세트의 명시적 갱신은 `--refresh`로 실행합니다. Base Set 102장과 Jungle 64장을 수집했으며 [Aggregator 가이드](packages/aggregator/README.md)에 잠금·재시도·진행 상태 규칙을 정리했습니다.

한국어 카탈로그는 `pnpm cards:collect:set --language ko --set SV5K`로 수집합니다. `SV4K`, `SV4M`도 지원하며 현재 제공 목록 기준 각각 49장·95장·95장을 저장했습니다. 실제 세트 전체의 완전성을 보장하지 않으며 한국 국내 시세 수집과는 별개입니다. `pnpm cards:collect --language ko --query 로젤리아 --limit 5`로 원문 검색 수집도 가능합니다. 언어별 UUID·수집 진행 상태는 분리됩니다.

## 외부 참고 시세 수집

```powershell
pnpm prices:collect --limit 20
```

저장된 외부 카드의 EUR/USD 가격을 수집하고 `/api/cards/:id/prices`에서 원본 통화·유형·검증 상태로 제공합니다. 현재 수집 카드의 에디션·상태는 미확정이므로 참고 가격으로만 표시합니다. 판본과 환율 근거를 확인한 표본만 USDC 평가에 반영할 수 있습니다. `.env`의 `PRICE_DATA_SOURCE=market`으로 평가 출처를 전환하며 기본 Mock 모드는 유지합니다. [Valuation 가이드](packages/valuation/README.md)에 검증 JSON과 사용 조건을 정리했습니다.

```powershell
pnpm infra:down
```

종료해도 데이터 볼륨은 유지됩니다. Compose 계정은 로컬 개발 전용입니다.

## 검증 및 개별 실행

```powershell
pnpm typecheck
pnpm test
pnpm test:db
pnpm build
pnpm --filter @tcg/api dev
pnpm --filter @tcg/web dev
pnpm --filter @tcg/aggregator test
```

모든 구현 패키지는 독립 `test` 스크립트를 제공합니다. `pnpm test`는 외부 DB 없이 실행할 수 있으며 DB 통합 테스트는 건너뜁니다. `pnpm test:db`는 루트 `.env`를 읽고 실제 PostgreSQL 통합 테스트까지 실행합니다. 마이그레이션을 먼저 적용하세요. 테스트 전용 DB가 있다면 `DATABASE_TEST_URL`로 지정할 수 있고 미지정 시 `DATABASE_URL`을 사용합니다. 통합 테스트는 시연 seed를 upsert하고 직접 생성한 임시 카드·표본만 정리합니다. `pnpm db:check`로 실제 연결과 테이블 존재도 확인할 수 있습니다.

내부 패키지는 개발 편의를 위해 소스(`src/index.ts`)를 공개합니다. Next.js는 `transpilePackages`, API는 `tsx`로 이를 실행합니다. 라이브러리 build는 `dist`를 생성하며 npm 배포·독립 Docker 이미지 패키징은 후속 작업입니다. 루트 `dev`는 Web/API만 실행합니다.

기본 명령은 Windows의 실행 파일 제어 정책에도 사용할 수 있도록 pnpm 자체 실행기를 사용합니다. Turborepo 설정도 포함되어 있으며 Turbo 실행이 허용된 환경에서는 `pnpm turbo:dev`, `pnpm turbo:build`로 실행·캐시를 사용할 수 있습니다.

## 현재 범위

카드 검색·상세 화면·Mock 적정가, API 오류 처리, 인증 컨텍스트 주입 지점, PostgreSQL 조회 어댑터·시연 seed·실제 DB 통합 테스트를 구현했습니다. [TCGdex 외부 카드 수집·영구 UUID 매핑·DB 저장](packages/aggregator/README.md) 후 기존 REST 경로에서 조회할 수 있으며 [외부 참고 시세 수집과 검증 표본 평가](packages/valuation/README.md)도 지원합니다. [Agent Runtime](apps/agent/README.md)은 카드 검색과 적정가를 조회하며, MCP 클라이언트 연결과 인증 컨텍스트 기반 세션 HTTP/SSE 플러그인을 제공합니다. 기존 DB/Mock 모드는 유지하며 미구현 live 모드로 조용히 대체하지 않습니다.

전체 카탈로그 동기화, 거래 가능한 카드 변형·상태 확정, 자동 환율 수집, 상용 인증, 매물·주문·정책 API, 팀 MCP 서버, 세션 영속화, Agent와 Core API·Web의 실제 연결, x402 결제 및 전체 거래 E2E는 후속 통합 범위입니다. Web의 거래·대화 화면은 미리보기이며 Agent 패키지 병합만으로 실제 요청·결제를 실행하지 않습니다.

가격은 USDC 최소 단위 정수 문자열입니다. UUID 및 UTC ISO 8601을 사용합니다. Mock 가격은 `dataSource: "MOCK"`로 구분하고, 표본이 없으면 `status: "INSUFFICIENT_DATA"`, `estimatedPrice: null`을 반환합니다. 이 확장은 초안 계약의 미정 부분을 구체화한 **팀 검토 대상**입니다. [계약 결정 사항](docs/contracts.md), [통합 가이드](docs/integration.md)를 확인하세요.
