# 모듈 통합 가이드

웹 인증은 [지갑 로그인](wallet-login.md)으로 전환했습니다. `auth.WalletIdentity/WalletChallenge/WalletSession`과 SIWE 서명을 사용하며 거래·예산·MCP 쓰기 요청의 사용자·Agent를 서버가 결정합니다. 지갑 로그인 토큰을 LLM 입력으로 보내지 않습니다. 익명 대화는 카드 조회만 가능하고, 공통 데모 역할로 자동 진입하지 않습니다.

이 가이드는 현재 코드의 조립 방법입니다. 2026년 11월 24일 확정한 목표 규칙은 [시스템 설계서 v2.2](system-design.md)·[API 계약서 v2.1](api-contract.md)·[합의 사항과 구현 차이](decisions.md)를 따릅니다. 조회 SSE와 서버 실행을 분리하고 정책 변경·중단 시 미제출 예약을 유지하는 규칙을 반영했습니다.

## 공개 API

```typescript
import { createAggregatorService, createAggregatorPlugin, createMockCardAdapter } from '@tcg/aggregator';
import { createValuationService, createValuationPlugin, createMockPriceAdapter } from '@tcg/valuation';

const aggregatorService = createAggregatorService({ adapter: createMockCardAdapter() });
const valuationService = createValuationService({ aggregatorService, adapter: createMockPriceAdapter() });

await app.register(createAggregatorPlugin({ aggregatorService }), { prefix: '/api' });
await app.register(createValuationPlugin({ valuationService }), { prefix: '/api' });
```

Service는 Fastify에 의존하지 않습니다. Plugin은 라우트 등록만 담당하며 `listen()`을 호출하지 않습니다. 독립 Fastify 호스트에서 사용하는 경우 공통 AppError·ZodError 처리를 호스트에 등록하세요.

DB 조회는 `createPrismaCardAdapter(prisma)`와 `createPrismaMockPriceAdapter(prisma)`로 교체합니다. 두 어댑터 모두 호스트가 관리하는 공통 Prisma Client를 주입받으며 직접 연결을 생성하거나 종료하지 않습니다. API는 `CARD_DATA_SOURCE=database`일 때 두 DB 어댑터를 함께 선택합니다.

## Core API 조립

`apps/api/src/app.ts`의 `buildApp()`에서 다음 순서로 초기화합니다.

1. Prisma Client 생성·연결 및 종료 hook 등록 (DB 활성화 시)
2. Aggregator·Valuation Service 생성
3. `createIntegrationPlugins(deps)` 호출
4. REST 및 전달받은 통합 Plugin 등록
5. `app.ready()` 후 반환; `server.ts`만 `listen()` 실행

후속 통합 코드는 `createIntegrationPlugins` 안에서 Trading → Payment → MCP 순서로 생성하고 해당 Plugin들을 반환합니다. 팩토리에서 초기화한 외부 리소스도 Plugin의 종료 hook으로 정리하세요. 테스트는 `buildApp()`과 `app.inject()`를 사용합니다.

현재 운영 팩토리는 Trading·정책/예산 REST, 서버 실행과 MCP를 등록합니다. `IntegrationDependencies.env`의 `TRADING_DATA_SOURCE`로 메모리/Prisma Store를 선택하고 통합 호스트에서 실행 기한·예약 만료·결제 복구 타이머를 관리합니다. DB 거래는 DB 연결 및 DB 카드 조회를 함께 요구합니다. 인증·시연 seed·실행 경로는 [트레이딩 통합 가이드](trading-integration.md)에 있습니다. Payment 증빙과 거래 MCP 도구를 공유 저장소에 연결합니다. 실제 LLM 실행은 executeAgentRun, 실제 지급은 paymentOptions/명시적 환경 설정으로 연결합니다.

Payment가 Trading Service 또는 정산 완료 콜백을 받는 단방향 연결을 권장합니다. Trading이 다시 Payment를 생성·호출하는 순환 의존성을 만들지 않습니다. 정산 증빙 확인, 멱등 체결, UNKNOWN 복구는 담당 모듈에서 구현하며 Core API에 복제하지 않습니다.

## 인증

카드·시세 조회는 공개입니다. 기본 `request.auth`는 null이며, 클라이언트의 사용자·Agent ID 헤더를 신뢰하지 않습니다. 검증된 인증 제공자를 `resolveAuth`로 주입하고, 보호된 라우트에서 `requireAuth(request)`를 호출하세요. 기본 진입점은 루프백 한정 데모 토큰만 제공하며 상용 인증 provider·Agent 지갑 소유권 확인은 주입해야 합니다.

Web은 Server Component를 통해 Core API를 호출하므로 API 주소·비밀값을 브라우저에 노출할 필요가 없습니다. Agent 세션 HTTP/SSE는 검증된 인증 제공자를 주입한 Core API에서 등록할 수 있습니다. [Agent 세션 플러그인 등록 방법](../apps/agent/README.md#세션-httpsse)을 참고하세요. 로컬 웹 채팅은 서명된 브라우저 쿠키로 조회용 Agent 세션을 열고 SSE를 중계합니다. 변경 요청용 BFF는 Web의 허용 목록 거래 경로에 연결했습니다. 브라우저 Origin/Host 검증과 안정적인 요청 키를 적용하며 지급 서명·실행 경로는 중계하지 않습니다.

## DB 소유권

| 스키마 | 책임 |
| --- | --- |
| auth | 사용자·Agent 인증 컨텍스트, 통합 담당 조율 |
| catalog | 정연한: 카드·시세 데이터 |
| market | 이채영: 인벤토리·고정가 매물 |
| agent | 최재민·최승원: 세션·정책 모델 조율 |
| trading | 이채영: 주문·예약·체결 |
| payment | 최승원: 결제·예산·정산 증빙 |

초기 Migration은 6개 논리 스키마와 catalog.CardVariant를 생성합니다. `20261124000000_trading_engine`은 market의 인벤토리·매물과 trading의 주문·예약·체결을 추가하며, 부분 유일 인덱스로 중복 활성 매물·예약을 제한합니다. Prisma 정의는 `packages/db/prisma/schema/`에서 관리하며 `base.prisma`는 공통 설정, `catalog.prisma`는 카드·시세, `trading.prisma`는 거래 모델입니다. 모델 변경 후 `pnpm --filter @tcg/db db:dev --name <변경명>`으로 Migration을 추가하고 검토합니다. 기존 Migration을 덮어쓰지 않습니다.

두 번째 Migration은 `catalog.PriceObservation`과 `PriceDataSource`를 추가합니다. 가격은 정수 문자열로 저장하며 Mock/시장 구분, 출처, 관측 시각과 카드 FK를 보존합니다. `pnpm db:seed`는 시연 데이터만 upsert합니다. 다른 모듈이 참조할 카드 UUID는 DB 모드와 Mock 모드에서 동일합니다.

외부 카드의 UUID는 `catalog.ExternalCardIdentity`에서 영구 매핑합니다. `pnpm cards:collect`는 이를 `CardVariant.id`로 사용하고 `externalIdentityId` FK로 출처를 연결하며 `lastCollectedAt`을 기록합니다. 카드 UUID와 연결 UUID의 동일성은 DB CHECK 제약으로 보장합니다. 수집 본문은 배치 단위로 저장하며 충돌 시 기존 식별자를 변경하지 않습니다. REST 조회는 저장된 DB 데이터만 읽습니다. 수집은 `catalog` 범위만 수정하며 가격 표본·인벤토리·주문·결제에는 쓰지 않습니다.


## 활성 Agent·승인 정책 경계

Core API는 `buildApp({ tradingExecutionContext })`에 주입된 현재 상태를 Trading으로 전달합니다. 토큰 인증만으로 신규 예약 권한을 부여하지 않으며, 기본 server.ts는 제공자 미주입으로 예약·매칭·주문 재개를 거부합니다. 등록·주문·예약 생성에는 Idempotency-Key가 필요합니다.

Agent의 `createAgentExecutionController({ resolvePolicy, pauseOrders })`는 단일 호스트의 세션 online 상태와 서버 측 승인 정책을 연결합니다. 반환된 실행 컨텍스트를 Trading에, 수명 콜백을 Agent 세션 Plugin에 주입합니다. 마지막 세션이 중단되면 먼저 offline으로 전환하고 미제출 주문을 중지합니다. Payment 제출 이후의 증빙 조회·체결 복구는 세션 상태로 중단하지 않습니다. 운영 팩토리에 Agent 세션을 등록하고 영속 정책을 제공하는 전체 연결은 이번 1차 계약 보정 범위 밖입니다.


## 합의 이후 변경할 실행 수명

브라우저/SSE 연결은 조회·구독의 수명이며 서버 Agent 실행의 수명과 분리합니다. 명시적 중단은 신규 실행을 막고 대기 주문을 중지하지만 기존 미제출 카드 예약을 즉시 해제하지 않습니다. 예약은 보류 상태로 원래 TTL을 유지합니다. 정책 수정에도 같은 원칙을 적용하고 결제 제출 승인 직전에 최신 정책·예산을 원자적으로 검사합니다. 현재 pauseAgentOrders의 즉시 해제와 sessions Plugin의 연결 종료 취소는 이 규칙에 맞춰 변경해야 합니다. Payment 제출 승인 이후는 Agent online 여부와 관계없이 서버가 증빙 확인·체결 복구를 계속합니다.
