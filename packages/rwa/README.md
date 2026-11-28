# RWA 서비스

마루 배포·고정가 견적 서명·NFT 업무·이벤트 동기화를 담당합니다. Fastify 호스트는 서비스 팩토리를 등록하고 개인키는 서버 클로저에서만 사용합니다. 조회 응답은 공통 `rwaViewSchema`/`rwaActionSchema`로 검증합니다.

```powershell
pnpm --filter @tcg/rwa test
pnpm --filter @tcg/rwa typecheck
pnpm rwa:deploy
# Core API를 중지한 뒤, 송금 없이 동기화
pnpm rwa:sync
pnpm rwa:sync -- --rebuild
```

`withWalletLock`은 API의 구매와 NFT 업무를 지갑별로 직렬화합니다. 지갑 키를 사용하는 API 인스턴스는 하나만 운영하세요. 작업은 DB에 요청 키·입력 해시를 먼저 보존하고 트랜잭션 해시를 방송 전에 기록합니다. 원문·키는 저장하지 않습니다. 결과가 불명확하면 동일 action ID를 조회하며 자동 재서명하지 않습니다.

Indexer는 finalized 블록만 처리하고 저장한 blockHash를 검증합니다. 이벤트 중복을 차단하며, 퍼실리테이터 응답이 유실된 기존 결제에 PurchaseExecuted 해시를 연결해 Payment의 영수증 검증·복구를 돕습니다. 인덱서가 결제를 직접 SETTLED로 만들지는 않습니다. `--rebuild`는 현재 배포의 로그 사본·커서만 재수집하고 NFT·실결제·거래·예산을 초기화하지 않습니다. 불일치가 발생하면 API를 중지하고 원인을 확인한 뒤 사용합니다.

테스트는 지갑 직렬화, 방송 응답 유실 시 중복 서명·방송 차단, 요청 키 결합, 가스비 부족, 이벤트 중복·응답 유실 복구를 확인합니다. [운영 범위와 API](../../docs/rwa.md)를 참고하세요.
