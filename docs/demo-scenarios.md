# 카드 검색부터 테스트넷 구매까지

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

루트 `.env`에 `OPENAI_API_KEY`, `AGENT_LOCAL_SECRET`, 서로 다른 `DEMO_BUYER_TOKEN`/`DEMO_SELLER_TOKEN`과 공개 지갑 주소 `AGENT_WALLET_ADDRESS`/`PAYMENT_RECIPIENT`를 설정합니다. 구매 지갑 개인키는 서버에 필요하지 않습니다. Web·API를 재시작하고 `/health`의 `scenarioDemo=true`, `paymentEnabled=true`, `priceDataSource=mock`, `tradingDataSource=database`를 확인합니다. 시나리오 모드는 원래 PRICE_DATA_SOURCE와 별개로 고정 합성 시세를 사용합니다.

## 구매 흐름

1. 에이전트의 예시를 보내면 MCP 검색·적정가·매물을 조회합니다. 실제 검색 카드의 활성 매물만 구매 버튼으로 표시하며 조회만으로 예약·결제하지 않습니다.
2. 구매 버튼에서 브라우저 지갑을 연결하고 Base Sepolia로 전환합니다.
3. 소유자 세션의 매물로 기존 정책·실행을 만들고 MCP `quote_fixed_purchase` → `execute_purchase`로 예약과 x402 요구를 받습니다.
4. 구매 지갑·USDC 잔액·금액·토큰·수납 주소를 확인한 뒤 지갑에서 EIP-712 지급 승인에 서명합니다.
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
