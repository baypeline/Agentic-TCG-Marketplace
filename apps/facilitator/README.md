# 자체 x402 퍼실리테이터

Base Sepolia USDC는 공식 `@x402/core`·`@x402/evm` 2.32.0 EVM exact / EIP-3009를 사용합니다. Maroo Testnet 네이티브 tOKRW는 x402 v2의 자체 확장 `maroo-native`를 사용하며 공식 ERC20 exact 방식과 다릅니다. [마루 실행 가이드](../../docs/maroo.md)에서 별도 DB·18자리 원장·서명·가스비·복귀 방법을 확인하세요. 아래 가스 지갑과 USDC 설명은 Base 프로필에 해당합니다. 마루는 구매 지갑이 결제와 가스비를 부담하고 퍼실리테이터는 동일 서명 원문을 방송합니다.

## 실행

루트 `.env`에 기존 구매·수납 공개 주소를 준비한 뒤 다음을 실행합니다.

```powershell
pnpm facilitator:init
pnpm facilitator:up
pnpm facilitator:logs
# 별도 프로젝트만 종료하며 정산 볼륨은 보존
pnpm facilitator:down
```

초기화는 별도 가스 지갑·무작위 호스트 포트·인증 토큰을 `infra/.env.facilitator`에 생성하고 API가 사용할 URL·동일 토큰만 루트 `.env`에 기록합니다. 재실행해도 가스 지갑 키를 교체하지 않습니다. 구매자 개인키·OpenAI 키·DB 비밀번호는 컨테이너에 전달하지 않습니다. 생성된 **가스 지갑에 Base Sepolia ETH**를 충전하고 API를 재시작하세요. USDC는 구매 지갑에, 가스비 ETH는 퍼실리테이터 지갑에 필요합니다. 퍼실리테이터는 구매 USDC를 수납하지 않습니다.

`infra/facilitator.compose.yaml`은 PostgreSQL Compose와 별도 프로젝트·컨테이너·네트워크·볼륨을 사용합니다. 호스트 노출은 `127.0.0.1:<생성 포트>`뿐이며 컨테이너 내부는 4022입니다. 비루트 사용자·읽기 전용 루트 파일시스템으로 실행하고 SQLite 정산 원장만 `/data`에 보존합니다. **`down -v`로 원장을 지우지 마세요.** 현재는 단일 인스턴스용입니다.

## 엔드포인트

| 경로 | 동작 |
| --- | --- |
| `GET /health` | 프로세스 준비 상태·체인·공개 가스 지갑 주소 |
| `GET /supported` | SDK가 등록한 지원 방식·네트워크 |
| `POST /verify` | Bearer 인증 후 허용된 지급의 SDK 검증, 전송 없음 |
| `POST /settle` | 검증·영속 중복 방지·온체인 정산과 영수증 반환 |

지원 체인·USDC 주소·수납처·구매 지갑 목록·건당 금액 상한을 검증합니다. 허용 구매 지갑·수납처를 바꾸면 `pnpm facilitator:init`을 다시 실행해 공개 주소 목록을 갱신하고 컨테이너를 재생성하세요. API 토큰과 개인키·서명 원문은 로그에 출력하지 않습니다. `/health` 정상 상태는 가스 잔액이나 실제 정산 성공을 뜻하지 않습니다.

## 중복 방지와 복구

정산 전 `(network, asset, payer, authorization nonce)`를 SQLite에 먼저 기록합니다. 같은 요청의 동시 제출은 직렬화하고 완료 결과는 재사용합니다. fingerprint에는 서명 해시·resource URL·서버가 발급한 `extra.tcgQuoteId`도 포함하므로 같은 지급을 다른 주문으로 바꿔 재사용할 수 없습니다. `tcgQuoteId`는 새 Payment 요구에 추가되는 메타데이터이며 기존 USDC 서명 도메인과 x402 공개 서버 사용은 유지됩니다.

브로드캐스트 해시는 영수증 대기 전에 저장합니다. 미확정 요청에 해시가 있으면 동일 트랜잭션의 영수증과 USDC Transfer 이벤트만 조회합니다. 해시를 기록하기 전 프로세스가 종료되었거나 RPC가 제출 여부를 알 수 없게 실패하면 `settlement_pending`을 유지하고 **자동 재전송하지 않습니다**. 이 경우 운영자가 해당 가스 지갑의 거래를 확인해야 합니다. 성공 여부가 불명확한 원장 항목을 삭제하거나 새 지급으로 대체하지 마세요. 원장에 개인키나 지급 서명 원문은 저장하지 않습니다.

Core API가 HTTP 응답 유실로 거래 해시를 받지 못한 경우에는 기존 Payment와 마찬가지로 UNKNOWN을 유지합니다. Core가 원장을 직접 조회하는 API는 아직 없으므로 이 경우에도 가스 지갑 거래와 SQLite 원장을 운영자가 대조해야 합니다. 퍼실리테이터의 재조회는 기존 동일 payload에 대한 `/settle` 요청을 기준으로 동작하며 새 전송을 수행하지 않습니다.

## 검증

```powershell
pnpm --filter @tcg/facilitator test
pnpm --filter @tcg/facilitator typecheck
pnpm --filter @tcg/facilitator build
```

테스트는 인증·지급 요구 변조·검증만으로 전송하지 않음·동시/반복 정산·주문 간 nonce 재사용·재시작 후 완료/미확정 복구를 확인합니다. 마루 테스트는 실제 서명과 로컬 RPC 대역으로 금액·수납처·nonce·가스 검증과 방송 전 해시 저장·중복 방송 방지를 확인합니다. 실제 마루 송금은 자동 테스트에 포함하지 않습니다.

2026-11-28 검증에서는 PostgreSQL 통합 테스트를 포함해 전체 330개 테스트·타입 검사·빌드를 통과했습니다. 실제 SDK 서명을 컨테이너의 `/verify`에서 검증하고, Web BFF→Agent→MCP→자체 퍼실리테이터로 이브이 0.005 테스트 USDC 구매를 완료했습니다. 온체인 트랜잭션의 가스 지급자가 자체 퍼실리테이터 지갑인 것, USDC 전송·DB 카드 이전·동일 구매 요청의 중복 지급 방지를 확인했습니다. 컨테이너 재시작 후에도 SQLite 완료 기록이 보존됐습니다. [실제 테스트넷 거래](https://sepolia.basescan.org/tx/0xdf2244a364b6d3e4a1e79b80da66ffce6ef2f16eca0bcb6be6712ebc112705e6).
