# Fastify Core API

`buildApp()`은 조립, 오류 처리, 인증 컨텍스트 및 자원 수명을 관리합니다. `server.ts`만 `listen()`을 호출합니다. 업무 로직은 packages의 Service에서 주입합니다.

운영 진입점은 Trading REST(`/api`)와 MCP(`/mcp`)를 등록합니다. 거래 모드, 로컬 인증, DB 시연 재고와 요청 예시는 [트레이딩 통합 가이드](../../docs/trading-integration.md)를 참고하세요. Trading은 예약까지 연결했으며 실결제와 Web 거래 화면 연결은 후속 범위입니다.

카드 조회는 공개입니다. 인증은 `resolveAuth`로 주입하고 보호된 라우트는 `requireAuth`를 호출합니다. 루트 `.env`를 읽으며 기본 포트는 4000입니다. 통합 확장점은 루트 `docs/integration.md`를 확인하세요.

루트에서 `pnpm --filter @tcg/api test`와 `pnpm --filter @tcg/api typecheck`로 검증합니다.

`GET /api/cards/:id/prices`는 DB에 저장된 외부 참고 시세와 판본·환율 검증 상태를 제공합니다. 쓰기용 공개 API는 없습니다. `PRICE_DATA_SOURCE=market`은 DB 카드 조회가 필요하며 검증된 표본만 평가합니다. 기본 mock과 실제 데이터를 섞지 않고, `/health.priceDataSource`에서 선택 모드를 확인합니다. 수집·검증 정책은 `@tcg/valuation`이 소유하고 호스트는 Service·Plugin만 조립합니다.

## 거래 정책 주입

`buildApp({ tradingExecutionContext })`의 `TradingExecutionContextReader`로 현재 사용자·Agent의 online 상태와 서버 측 사전 승인 정책을 전달합니다. 기본 server.ts는 이 제공자를 만들지 않으므로 데모 인증 토큰만 설정해도 신규 예약·매칭·주문 재개는 `POLICY_VIOLATION`으로 거부합니다. 매물·주문 등록·조회·취소는 인증 컨텍스트에 따라 처리합니다. 실제 세션/정책 저장소 연결은 후속 통합이며 테스트는 명시적으로 가짜 정책 제공자를 주입합니다.

생성 요청(매물·주문·예약)은 `Idempotency-Key`가 필수입니다. 누락 시 400, 같은 키의 다른 입력은 `IDEMPOTENCY_CONFLICT` 409, 같은 입력의 재시도는 최초 응답을 반환합니다. 예약의 현재 상태는 `/api/matches/:id`에서 확인하세요.
