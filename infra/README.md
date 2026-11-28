# 로컬 인프라

자체 x402 퍼실리테이터는 PostgreSQL과 별도의 `infra/facilitator.compose.yaml`로 실행합니다. `pnpm facilitator:init` → `pnpm facilitator:up` 순서로 구성하고 출력된 가스 지갑에 Base Sepolia ETH를 충전하세요. `pnpm facilitator:down`은 퍼실리테이터만 종료합니다. API 연결에는 생성된 루트 `.env`의 `PAYMENT_FACILITATOR_URL`·`PAYMENT_FACILITATOR_TOKEN`이 사용되며 API 재시작이 필요합니다. [가스 지갑·정산 원장·복구 안내](../apps/facilitator/README.md)를 참고하세요.

저장소 루트에서 최초 1회 `pnpm env:init`으로 `.env`를 생성한 뒤 `pnpm infra:up`으로 PostgreSQL 17을 실행합니다. Docker Engine이 필요하며 `127.0.0.1:<POSTGRES_PORT>`만 공개합니다. `pnpm infra:down`은 컨테이너를 종료하고 볼륨은 유지합니다.

Compose는 루트 `.env`의 `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `POSTGRES_PORT`를 사용합니다. 직접 실행할 때도 `docker compose --env-file .env -f infra/compose.yaml ...`로 지정하세요. 기존 데이터 볼륨이 있다면 환경변수를 바꿔도 저장된 DB 계정·비밀번호는 변경되지 않습니다.

연결 문자열은 루트 `.env.example`을 참고하세요. `pnpm db:migrate`, `pnpm db:seed`, `pnpm db:check` 순서로 스키마·시연 데이터를 준비하고 실제 연결을 검증하세요. API의 DB 연결은 `DATABASE_ENABLED=true`, DB 카드 조회는 `CARD_DATA_SOURCE=database`로 활성화합니다. `DATABASE_ENABLED=false`, `CARD_DATA_SOURCE=mock`이면 DB 없이 Mock 데모를 실행할 수 있습니다.
