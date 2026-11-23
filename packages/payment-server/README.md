# Payment Server

Base Sepolia에서 0.01 테스트 USDC 결제 조건을 생성하고, x402 Facilitator를 통해 지급 승인을 검증·정산한다.

- `createTestPaymentRequirements()`는 플랫폼 수납 주소와 고정 금액이 담긴 결제 조건을 생성한다.
- `verifyPayment()`와 `settlePayment()`는 서버가 발행한 원래 견적의 건별 한도와 서명된 금액의 일치 여부를 검사한 뒤 Facilitator를 호출한다.

## 결제 모듈 검증

Node.js 24.x, pnpm 12.9.1 환경에서 레포 루트에서 실행한다.

```bash
pnpm --filter '@tcg/payment-*' typecheck
pnpm --filter '@tcg/payment-*' test
pnpm --filter '@tcg/payment-*' build
```

클라이언트 테스트 5개와 서버 테스트 2개가 통과했다. 서버 테스트는 한도를 초과한 요청이 `/verify`와 `/settle` 어느 쪽에도 전달되지 않는지 확인한다.

## 테스트넷 정산 증빙

2026년 11월 21일, Base Sepolia에서 에이전트 지갑 `0xdff4…2886`이 플랫폼 수납 지갑 `0xa755…ae9C`으로 0.01 테스트 USDC를 지급했다. 블록 `61656119`에서 거래 상태 `Success`와 ERC-20 전송 금액을 확인했다.

[BaseScan 트랜잭션 영수증](https://sepolia.basescan.org/tx/0xdc3cfd801f427b93a843b80e566ec1b20d384fab6a91178fc2869a993a38bf6b)