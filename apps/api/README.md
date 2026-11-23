# Fastify Core API

`buildApp()`은 조립, 오류 처리, 인증 컨텍스트 및 자원 수명을 관리합니다. `server.ts`만 `listen()`을 호출합니다. 업무 로직은 packages의 Service에서 주입합니다.

카드 조회는 공개입니다. 인증은 `resolveAuth`로 주입하고 보호된 라우트는 `requireAuth`를 호출합니다. 루트 `.env`를 읽으며 기본 포트는 4000입니다. 통합 확장점은 루트 `docs/integration.md`를 확인하세요.

루트에서 `pnpm --filter @tcg/api test`와 `pnpm --filter @tcg/api typecheck`로 검증합니다.

`GET /api/cards/:id/prices`는 DB에 저장된 외부 참고 시세와 판본·환율 검증 상태를 제공합니다. 쓰기용 공개 API는 없습니다. `PRICE_DATA_SOURCE=market`은 DB 카드 조회가 필요하며 검증된 표본만 평가합니다. 기본 mock과 실제 데이터를 섞지 않고, `/health.priceDataSource`에서 선택 모드를 확인합니다. 수집·검증 정책은 `@tcg/valuation`이 소유하고 호스트는 Service·Plugin만 조립합니다.
