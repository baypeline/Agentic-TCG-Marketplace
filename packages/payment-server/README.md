# Payment Server

`createX402SettlementAdapter({ facilitatorUrl, facilitatorToken, getWalletAddress })`로 자체 퍼실리테이터를 선택할 수 있습니다. 기본 URL은 기존 공개 서버이며 선택 토큰은 SDK의 경로별 인증 헤더로 전달합니다. 새 결제 요구의 `extra.tcgQuoteId`는 자체 퍼실리테이터의 주문별 중복 방지에 사용합니다. [별도 컨테이너 실행 안내](../../apps/facilitator/README.md)를 참고하세요.

`createPolicyService`는 정책 버전 이력, policyId별 누적 예산과 서버 실행을 관리합니다. `createPaymentService`는 MatchQuote에 결합한 x402 요구와 제출·복구를 처리합니다. 두 서비스는 Trading과 같은 저장소·트랜잭션 경계를 사용합니다. [계약서](../../docs/api-contract.md)의 구체 DTO를 따릅니다.

- 외부 정산 전에 최신 정책·실행·카드·가용 예산을 재검사하고 예산 예약, PENDING, 정책 버전, 카드 보호를 원자적으로 저장합니다.
- SETTLED는 reserved→spent로 이동하고 체결을 호출합니다. 체결 실패는 지급을 다시 하지 않고 Trade만 복구합니다.
- PENDING/UNKNOWN은 새 시도·서명을 받지 않습니다. 기존 해시의 체인 영수증과 USDC 전송을 조회하며, 해시가 없으면 UNKNOWN을 유지합니다. 시간만으로 실패 처리하지 않습니다.
- 확정 실패만 예산을 반환하고 카드를 해제합니다. 장기 미확정·체결 지연은 needsReview로 표시합니다. 운영자 강제 상태 변경 API는 없습니다.
- 서명 원문은 영속 저장하지 않으며 사용자별 허용 지갑·금액·네트워크·자산·수신자에 지급을 결합합니다.

`createCommercePlugin`은 정책 CRUD/예산과 구매 상태 조회를 등록합니다. 지급 실행은 MCP 전용이며 임의 정산 REST는 제공하지 않습니다. `createX402SettlementAdapter`는 Base Sepolia·USDC와 x402 Facilitator를 사용합니다. Core API는 명시적인 `PAYMENT_ENABLED=true` 및 DB 거래 설정이 있을 때만 이 어댑터를 연결합니다.

기존 `createTestPaymentRequirements`/`verifyPayment`/`settlePayment`는 0.01 USDC 독립 검증용 도우미입니다. 거래 금액 결제에는 업무 서비스를 사용합니다.

## 검증

```sh
pnpm --filter '@tcg/payment-*' typecheck
pnpm --filter '@tcg/payment-*' test
pnpm --filter '@tcg/payment-*' build
```

`DATABASE_TEST_URL`을 설정하면 두 Prisma 연결의 동시 예산 제출과 서비스 재생성 후 원장 보존을 검증합니다. 정책 수정 순서·UNKNOWN 보호·중복 정산·체결 실패 복구는 주입한 어댑터로 검증합니다. 이번 변경에서는 실제 Facilitator 정산을 새로 실행하지 않았습니다.

## 테스트넷 정산 증빙

2026년 11월 21일, Base Sepolia에서 에이전트 지갑 `0xdff4…2886`이 플랫폼 수납 지갑 `0xa755…ae9C`으로 0.01 테스트 USDC를 지급했다. 블록 `61656119`에서 거래 상태 `Success`와 ERC-20 전송 금액을 확인했다.

[BaseScan 트랜잭션 영수증](https://sepolia.basescan.org/tx/0xdc3cfd801f427b93a843b80e566ec1b20d384fab6a91178fc2869a993a38bf6b)
