# 시장 가격 수집·평가 점검

기준일: 2026년 11월 24일. 로컬 DB와 제공자의 당시 응답을 확인한 기록이며 이후 가격·검증 상태는 달라질 수 있습니다.

후속 데모 정책 변경: 이 기록의 검증 제한은 `MARKET_VALUATION_MODE=strict` 기준입니다. 현재 기본 `demo` 모드는 실제 USD 시장 집계가를 1 USD ≈ 1 USDC로 표시하며, 판본·보존 상태 미보정 조건을 명시합니다. 따라서 아래의 strict 사용 가능 표본 0건은 데모 가격을 표시할 수 없다는 뜻이 아닙니다.

데모 모드로 다시 점검한 171장 중 169장은 사용 가능한 USD 가격이 있습니다. 실제 REST와 MCP를 통한 Web 채팅에서 Pikachu base1/58의 7.84 USDC 안내를 확인했습니다. Eevee base2/51은 2.17 USDC, Charizard base1/4는 1,001.05 USDC입니다. 모두 당시 제공자 가격의 1:1 데모 환산이며 실제 USDC 환율이나 실물 상태별 거래가를 검증한 결과는 아닙니다. USD 시장 가격이 없는 두 카드는 자료 부족을 유지합니다.

## 수집 결과

- `pnpm prices:collect --limit 200`으로 영어 TCGdex 연결 카드 171장을 모두 조회했습니다.
- 카드 171장 모두 참고 가격이 있으며 제공자·변형·가격 유형별 최신 가격은 1,145건입니다.
- 현재 평가 사용 가능 표본은 0건입니다. 미검증 집계 가격 403건과 참고 전용 판매 희망가·추세 가격 742건으로 구분됩니다.
- 공유 fixture에는 최신 원본 가격·제공자 갱신 시각·수집 시각을 내보냈습니다. 사용자 거래나 인증 정보는 포함하지 않습니다.
- API를 다시 시작해 `/health.priceDataSource=market`, `cardDataSource=database`, `database=connected`를 확인했습니다.

실제 REST 응답도 공통 Zod Schema로 검증했습니다. 아래 세 카드 모두 `dataSource=MARKET`, `status=INSUFFICIENT_DATA`, `estimatedPrice=null`이며 Mock을 섞지 않습니다.

| 카드 | 세트·번호 | 최신 참고 가격 |
| --- | --- | --- |
| Pikachu | base1 / 58 | 6건 |
| Eevee | base2 / 51 | 8건 |
| Charizard | base1 / 4 | 6건 |

## 아직 USDC 적정가를 제공할 수 없는 이유

171장의 에디션과 보존 상태가 모두 `UNSPECIFIED`이며 판본·환율 검증 기록이 없습니다. 참고 가격 수집은 성공했지만 같은 조건의 카드 가격인지 확인되지 않아 `INSUFFICIENT_DATA`가 정상입니다. 기존 카드나 거래 대상의 속성을 임의로 NORMAL/NM으로 바꾸지 않았습니다.

[TCGdex FAQ](https://tcgdex.dev/faq)는 서로 다른 판본이 동일 외부 매물에 연결될 수 있는 가격 매핑 한계를 설명합니다. [가격 응답 문서](https://tcgdex.dev/reference/card)의 일반·홀로·초판 구분만으로 실물 보존 상태를 확인할 수는 없습니다. 이 구분이나 원문 카드 이름만으로 NM 상태를 추정해 승인하지 않습니다. USD와 USDC도 검증 없이 1:1로 환산하지 않습니다.

## 점검과 검증 순서

```powershell
pnpm prices:collect --limit 200
pnpm prices:check
pnpm prices:check --card-id <카드-UUID> --file C:/absolute/path/readiness.json
```

`prices:check`는 가격 자료와 평가 적격 여부를 읽기 전용으로 보고하며 승인 작업은 수행하지 않습니다. 제공자 집계 가격의 수는 실제 체결 건수가 아닙니다. 이후 확정된 언어·에디션·보존 상태의 거래 대상과 일치하는 외부 가격을 근거로 확인하고, 원본 통화→USDC 환율과 관측 시각을 확보한 후 `prices:assess --file`로 기록합니다. 새 스냅샷이나 만료된 가격·환율은 다시 확인해야 합니다. 상세 형식은 [Valuation README](../packages/valuation/README.md)를 따릅니다.

Web은 원본 통화의 참고 가격을 계속 보여주고, 평가 근거 영역에서 미수집과 조회 실패, 판본·환율 미검증, 만료, 속성 불일치를 구분합니다. 가격이 0이거나 MCP가 연결되지 않은 것으로 안내하지 않습니다.
