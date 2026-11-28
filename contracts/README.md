# 카드 NFT 컨트랙트

Foundry, Solidity 0.8.28, OpenZeppelin 5.0.2, Paris EVM을 고정합니다. 최신 OpenZeppelin의 Cancun opcode 의존성을 피하고 마루 테스트넷에서 직접 배포·구매를 검증한 조합입니다. `CardVaultNFT`는 ERC-721 보관 데모, `CardMarketplace`는 NFT 예치·서명 견적·원자적 구매·판매 대금 출금입니다.

```powershell
pnpm rwa:build
forge test --root contracts -v
```

표준 ERC-721의 `safeTransferFrom`으로 예치하세요. ERC-721의 안전하지 않은 `transferFrom`으로 마켓에 직접 보내는 것은 거래 등록이 아니며 자산을 잠글 수 있습니다. 마켓 UI는 승인 후 createListing만 사용합니다. 관리자에게 임의 NFT 회수 기능을 제공하지 않습니다.

`out`, `cache`, `broadcast`는 커밋하지 않습니다. ABI는 `pnpm rwa:build`로 생성하며 클라이언트가 실제 사용하는 계약 산출물이므로 `packages/payment-client/src/rwa-abi.ts`를 소스와 함께 커밋합니다. `deployments/maroo-testnet.json`에는 공개 주소·해시·배포 단계만 보관합니다. 이전 배포를 지우거나 개인키를 바꿔 같은 배포 기록을 재사용하지 마세요.

로컬 테스트는 구매/취소 경합, 잘못된 가격·구매자·체인·견적, 재사용, 수신 실패의 전체 롤백, 무단/중복 민팅, 판매 승인, 인출 잠금·취소·소각과 역할 제한을 검사합니다. [실행 및 검증 기록](../docs/rwa.md)을 참고하세요. 외부 보안 감사를 받은 컨트랙트라는 의미는 아닙니다.
