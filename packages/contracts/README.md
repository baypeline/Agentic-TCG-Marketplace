# 공통 DTO / Schema

`@tcg/contracts/payment-profile`은 Base Sepolia USDC와 Maroo tOKRW의 체인·자산·정밀도·기본 정책 및 `formatMoney`를 공개합니다. Docker Node 런타임에서도 직접 읽도록 순수 JS와 타입 선언으로 제공합니다. 금액 DTO는 최소 단위 정수 문자열이며 tOKRW는 18자리입니다. 결제 요구는 네트워크·scheme·asset의 조합과 마루 주문 ID·만료 시각을 검증합니다. [마루 가이드](../../docs/maroo.md)를 참고하세요.

개정 [API 계약서 v2.1](../../docs/api-contract.md)과 [합의 사항](../../docs/decisions.md)은 정책 id·version 및 TRANSFERRED 제거를 요구합니다. 현재 TypeScript 스키마에는 아직 반영되지 않은 변경이 있으므로 문서 개정을 런타임 계약 변경으로 간주하지 마세요.

DTO는 Zod Schema에서 추론합니다. 공통 오류 코드, `AppError`, Aggregator·Valuation Service 계약을 공개합니다. UUID, UTC 날짜, USDC 정수 문자열을 사용합니다. 미정 계약은 루트 `docs/contracts.md`를 확인하세요.

루트에서 `pnpm --filter @tcg/contracts test`와 `pnpm --filter @tcg/contracts typecheck`로 검증합니다.

구매 진행 DTO의 선택 필드 `signingMode=browser|server`는 브라우저 지갑과 에이전트 전용 지갑 서명을 구분합니다. 미설정은 기존 browser 흐름이며, `/api/demo`도 같은 필드를 제공합니다. 구매 요청의 action과 MCP 결제 payload 계약은 유지합니다. 개인키 필드는 DTO에 없습니다.


거래 요청 스키마(`createListingInputSchema`, `createBuyOrderInputSchema`, `fixedPurchaseInputSchema`, `marketPurchaseInputSchema`, `listingQuerySchema`)와 `mutationContextSchema`를 REST·MCP·Service에서 공유합니다. 시장가의 maxPrice는 필수이며 생성 요청의 키는 1~128자의 영문·숫자·점·밑줄·콜론·하이픈입니다. `TradingExecutionContextReader`는 검증된 사용자·Agent의 현재 online 상태와 사전 승인 정책을 전달합니다. `purchaseConditionSchema`는 Agent 구매 조건의 전략·필수 USDC 상한·선택 할인율을 표현합니다.
