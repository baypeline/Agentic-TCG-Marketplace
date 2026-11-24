# 공통 DTO / Schema

DTO는 Zod Schema에서 추론합니다. 공통 오류 코드, `AppError`, Aggregator·Valuation Service 계약을 공개합니다. UUID, UTC 날짜, USDC 정수 문자열을 사용합니다. 미정 계약은 루트 `docs/contracts.md`를 확인하세요.

루트에서 `pnpm --filter @tcg/contracts test`와 `pnpm --filter @tcg/contracts typecheck`로 검증합니다.


거래 요청 스키마(`createListingInputSchema`, `createBuyOrderInputSchema`, `fixedPurchaseInputSchema`, `marketPurchaseInputSchema`, `listingQuerySchema`)와 `mutationContextSchema`를 REST·MCP·Service에서 공유합니다. 시장가의 maxPrice는 필수이며 생성 요청의 키는 1~128자의 영문·숫자·점·밑줄·콜론·하이픈입니다. `TradingExecutionContextReader`는 검증된 사용자·Agent의 현재 online 상태와 사전 승인 정책을 전달합니다. `purchaseConditionSchema`는 Agent 구매 조건의 전략·필수 USDC 상한·선택 할인율을 표현합니다.
