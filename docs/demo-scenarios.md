# 카드 검색부터 테스트넷 구매까지

현재 기본 예시는 한국어판 치라미·쉐이미·누니머기입니다. `pnpm demo:seed`는 기존 영어판 3종을 보존하며 한국어판 20종·매물 40개를 추가합니다. 마루 매물은 3~13 tOKRW이고 새 한국어판은 일반 DB 재고입니다. 기존 RWA NFT 3종을 교체하거나 추가 NFT를 자동 발행하지 않습니다. [공식 이미지 수집·오프라인 복원](korean-card-images.md)을 참고하세요. 아래 세 영어판 예시·USDC 금액은 이전 프로필 기록입니다.

아래는 기존 Base Sepolia USDC 프로필입니다. 마루 tOKRW의 별도 DB·가격·예산·가스비·초기화는 [마루 실행 가이드](./maroo.md)를 따르세요. `PAYMENT_CHAIN`만 바꾸어 기존 DB를 전환하지 않습니다.

수집된 카드 정보·이미지를 바탕으로 만든 **합성 카드·가격·판매 재고**를 사용합니다. 시세와 NM 상태는 실제 실물 평가를 뜻하지 않습니다. 결제는 **Base Sepolia 테스트 USDC 실제 전송**입니다.

## 세 예시와 시드

| 에이전트 예시 | 합성 적정가 | 매물 두 장 |
| --- | --- | --- |
| 피카츄 찾아서 구매 가능한 매물도 알려줘 | 0.015 USDC | 0.01 / 0.012 USDC |
| 리자몽 적정가와 지금 살 수 있는 가격을 알려줘 | 0.03 USDC | 0.02 / 0.025 USDC |
| 이브이 시세와 거래 가능한 매물을 보여줘 | 0.008 USDC | 0.005 / 0.006 USDC |

최저가 한 장씩은 총 0.035 테스트 USDC입니다. 기본 데모 정책은 카드 세 종, 건당 0.025, 누적 0.1 USDC 한도입니다. 정책·예산과 원장 검증은 기존 모듈을 그대로 사용합니다.

`packages/db/fixtures/demo/scenarios.json`에 원본 카드 UUID, 별도 합성 카드 UUID, 가격, 예시 문장을 보관합니다. 원본 수집 카드의 속성·가격은 변경하지 않습니다. 검색은 데모 카드로 제한하되 기존 보유 카드·거래 내역의 상세 조회는 유지합니다. 고정 MOCK 시세는 원래 관측 시각을 보존하고 만료시키지 않습니다. 조회 중 외부 카드 API를 호출하지 않으며 OpenAI·RPC·Facilitator와 원격 이미지에는 인터넷이 필요합니다.

```powershell
pnpm db:migrate
pnpm demo:seed
# 기존 거래를 보존하고 다음 촬영용 재고 여섯 장을 추가할 때
pnpm demo:seed --round take2
```

동일 round 재실행은 기존 소유권·SOLD·취소·예약을 되돌리지 않습니다. 다른 round는 재고·매물만 추가하며 정책 예산이나 거래 내역을 초기화하지 않습니다.

## 로컬 설정

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
DATABASE_ENABLED=true
CARD_DATA_SOURCE=database
TRADING_DATA_SOURCE=database
DEMO_SCENARIOS_ENABLED=true
PAYMENT_ENABLED=true
WEB_DEMO_ROLE=buyer
```

루트 `.env`에 `OPENAI_API_KEY`, `AGENT_LOCAL_SECRET`, 서로 다른 `DEMO_BUYER_TOKEN`/`DEMO_SELLER_TOKEN`과 공개 지갑 주소 `AGENT_WALLET_ADDRESS`/`PAYMENT_RECIPIENT`를 설정합니다. 기본 `AGENT_SIGNING_MODE=browser`에서는 구매 지갑 개인키가 서버에 필요하지 않습니다. Web·API를 재시작하고 `/health`의 `scenarioDemo=true`, `paymentEnabled=true`, `priceDataSource=mock`, `tradingDataSource=database`를 확인합니다. 시나리오 모드는 원래 PRICE_DATA_SOURCE와 별개로 고정 합성 시세를 사용합니다.

### 에이전트 전용 지갑 자동 서명

`pnpm agent:wallet:init`은 루트 `.env`에 전용 개인키 `AGENT_SERVER_PRIVATE_KEY`, 공개 주소 `AGENT_SERVER_WALLET_ADDRESS`, `AGENT_SIGNING_MODE=server`를 구성합니다. 기존 `AGENT_WALLET_ADDRESS`는 브라우저 모드 복귀용으로 보존하며, 재실행해도 전용 키를 교체하지 않습니다. 개인키는 화면·LLM·MCP·로그에 전달하지 않습니다. `.env`는 Git에 포함하지 마세요. 전용 지갑을 복구하려면 이 파일의 키를 안전하게 보관해야 합니다.

출력된 **새 주소**에 Base Sepolia 테스트 USDC만 소액 충전하고 API를 재시작하세요. `/api/demo`의 `signingMode=server`와 `payer`가 새 주소인지 확인합니다. 브라우저 지갑 연결·서명 팝업 없이 ‘에이전트 지갑으로 구매’를 누르면 서버가 x402 지급 승인을 서명합니다. 채팅으로 카드를 조회하는 것만으로 송금하거나 백그라운드에서 매물을 계속 구매하지는 않습니다.

서명기는 Base Sepolia USDC·설정 수납처·서버 매물 금액과 건당 **최대 0.025 USDC**를 검사합니다. 기본 누적 예산 **0.1 USDC**는 기존 DB 정책에 저장되며 브라우저 모드에서 소비한 예산도 공유합니다. 정책 비활성화·실행 중단·예산 부족·예약 만료는 기존 Payment/Trading에서 재검사합니다. 정책을 수정해도 서명기의 건당 상한을 초과할 수 없습니다. 지급 미제출 상태의 잔액 부족은 충전 후 다시 구매할 수 있고, 결과가 불명확할 때는 ‘기존 결제 확인’을 먼저 눌러 주세요.

서버 서명은 로컬 시나리오 모드에서만 허용하며 production에서는 거부합니다. `AGENT_SIGNING_MODE=browser`로 변경하고 API를 재시작하면 보존한 기존 브라우저 지갑으로 돌아갑니다. 이미 제출된 결제는 모드 변경으로 취소되지 않으며 복구 작업이 기존 증빙만 조회합니다. 원격 모델이나 브라우저 요청이 임의의 서명 메시지·개인키·수납처를 지정할 수 있는 범용 서명 API는 제공하지 않습니다.

## 구매 흐름

1. 에이전트의 예시를 보내면 MCP 검색·적정가·매물을 조회합니다. 실제 검색 카드의 활성 매물만 구매 버튼으로 표시하며 조회만으로 예약·결제하지 않습니다.
2. 구매 버튼에서 지급 방식을 확인합니다. browser 모드에서는 브라우저 지갑을 연결하고 Base Sepolia로 전환하며, server 모드에서는 충전한 전용 지갑을 사용합니다.
3. 소유자 세션의 매물로 기존 정책·실행을 만들고 MCP `quote_fixed_purchase` → `execute_purchase`로 예약과 x402 요구를 받습니다.
4. 구매 지갑·USDC 잔액·금액·토큰·수납 주소를 확인한 뒤 EIP-712 지급 승인에 서명합니다. server 모드는 현재 정책 검증 후 서버에서 서명합니다.
5. 서명을 MCP의 x402 메타데이터로 제출합니다. 기존 Payment가 검증·정산하고 Trading이 소유권·매물·Trade를 반영합니다.
6. 영수증의 BaseScan·내 카드·거래 내역에서 결과를 확인합니다. 열려 있는 거래 화면도 다시 조회합니다.

## 오류와 재시도

- 소유자 대화에서 안내한 매물만 허용하며 클라이언트의 임의 가격·구매자 ID는 사용하지 않습니다.
- 같은 requestId는 정책·실행·예약 키를 재사용합니다. 제출한 지급은 새 서명·정산 대신 기존 상태를 조회합니다.
- 지갑 거절·잔액 부족·서명 전 실패는 미제출 예약을 해제합니다. 제출 결과가 불명확하면 원래 요청과 ‘기존 결제 확인’을 유지합니다.
- PENDING/UNKNOWN은 완료로 표시하지 않고 Payment 복구를 기다립니다. 제출 결제를 TTL이나 채팅 초기화만으로 취소하지 않습니다.
- 세션은 메모리이므로 API 재시작·만료 뒤 구매 버튼을 재사용하지 않습니다. 영속 거래·예산·결제는 거래 관리에서 확인합니다.
- 로컬 시연은 공유 구매자·Agent 역할을 사용합니다. 브라우저 대화 접근은 분리하지만 거래 역할·예산은 공유합니다. 운영 인증을 대체하지 않습니다.

자동 검증은 가짜 모델·정산 어댑터와 지갑 RPC 모형으로 MCP 예약→지급→소유권 이전, 중복 지급 방지, 취소, 미확정 결제, 잘못된 지갑·잔액 부족, 시드 소유권 보존을 확인합니다. 실제 지갑 서명·송금은 별도 확인이 필요하며 자동 테스트를 실제 온체인 정산 성공으로 보고하지 않습니다.

서버 서명 추가 시 PostgreSQL 통합 검증을 포함해 320개 테스트와 전체 타입 검사·빌드를 통과했습니다. 실제 x402 SDK가 만든 서명의 지급 주체를 암호학적으로 복원하고, 정책 변경·중단·예산 부족·만료 시 서명 차단 및 기존 지갑 증빙 복구를 확인했습니다. 로컬 DB 테스트는 패키지를 순서대로 실행하고 테스트 제한 시간을 20초로 늘려 Docker 시작 직후의 부하를 피했습니다.

충전한 전용 지갑으로 Web BFF → 실제 Agent 매물 조회 → MCP 예약 → 서버 자동 서명 → x402 정산을 실행해 이브이 한 장을 0.005 테스트 USDC에 구매했습니다. 브라우저 서명이나 클라이언트 paymentPayload 없이 제출하고, Base Sepolia 영수증의 USDC Transfer 이벤트·양 지갑의 0.005 USDC 잔액 변화·보유 카드 1장 증가·Trade 저장을 확인했습니다. 동일 submit 재요청은 같은 Trade를 반환했습니다. [실제 테스트넷 거래](https://sepolia.basescan.org/tx/0xd4537245d8cbcd8522ebdf9ecd61e4b32d8374c861ef22b3bf81bec07bb808ed). 이 검증은 HTTP 경로 기준이며 브라우저 화면의 클릭·개봉 연출은 재실행하지 않았습니다.
