# 공통 설정

`parseApiEnv()`와 TypeScript strict 기본 설정을 제공합니다. `.env` 로드는 실행 호스트가 담당합니다. 현재 `DATA_MODE`는 mock만 허용합니다.

`CARD_DATA_SOURCE=mock|database`로 카드와 Mock 표본의 저장 위치를 선택합니다. database에는 `DATABASE_ENABLED=true`와 `DATABASE_URL`이 필요합니다.

`PRICE_DATA_SOURCE=mock|market`로 가격 출처를 별도로 선택합니다. 기본은 mock이며 market에는 DB 카드 조회와 DB 연결이 모두 필요합니다. 시장 모드는 DB에 저장되고 판본·환율 근거가 확인된 표본만 평가하며 Mock으로 대체하지 않습니다. `DATA_MODE=mock`은 기존 실행 환경 구분으로 유지하고 가격 출처를 판별하는 데 사용하지 않습니다.

루트에서 `pnpm --filter @tcg/config test`와 `pnpm --filter @tcg/config typecheck`로 검증합니다.
