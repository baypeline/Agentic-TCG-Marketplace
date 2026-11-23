'use client';

import styled from '@emotion/styled';
import type { MarketPricesResponse } from '@tcg/contracts';
import { eligibilityLabels, priceTypeLabels, formatProvider, formatVariant, formatUtc, formatAttribute } from '../lib/formatters';
import { Badge, Notice } from './ui';

export function MarketPrices({ prices }: { prices: MarketPricesResponse }) {
  return <Section aria-labelledby="market-prices-heading"><Heading><h2 id="market-prices-heading">해외 참고 시세</h2><Badge>원본 통화 유지</Badge></Heading>
    <Description>해외 제공자의 집계·판매 희망 가격이며, 한국어판 실거래가가 아닙니다. 원본 통화로 표시합니다.</Description>
    {prices.items.length === 0 ? <Notice title="수집된 외부 가격 자료가 없습니다.">원본 자료가 생기면 이곳에서 확인할 수 있습니다.</Notice> : <TableWrap><Table>
      <thead><tr><th scope="col">제공자·변형</th><th scope="col">가격 유형</th><th scope="col">원본 금액</th><th scope="col">갱신 시각 (UTC)</th><th scope="col">검증 상태</th></tr></thead>
      <tbody>{prices.items.map(price => <tr key={price.id}>
        <td data-label="제공자"><strong>{formatProvider(price.provider)}</strong><Small>{formatVariant(price.providerVariant)}</Small><Evidence><summary>출처·근거 보기</summary><a href={price.sourceUrl} target="_blank" rel="noopener noreferrer">수집 출처</a>
          {price.assessment && <><p>확인 속성: {price.assessment.language} / {formatAttribute(price.assessment.edition)} / {formatAttribute(price.assessment.condition)}</p><a href={price.assessment.matchEvidenceUrl} target="_blank" rel="noopener noreferrer">판본 확인 근거</a><p>원본 통화 1단위 = {price.assessment.fxRate} USDC</p><a href={price.assessment.fxSourceUrl} target="_blank" rel="noopener noreferrer">환율 근거</a><p>환율 시각 (UTC): {formatUtc(price.assessment.fxObservedAt)}</p></>}
        </Evidence></td>
        <td data-label="가격 유형">{priceTypeLabels[price.priceType]}</td>
        <Amount data-label="원본 금액">{price.originalAmount} {price.originalCurrency}</Amount>
        <td data-label="갱신 시각"><time dateTime={price.observedAt}>{formatUtc(price.observedAt)}</time></td>
        <td data-label="검증 상태"><Badge tone={price.eligibility === 'ELIGIBLE' ? 'success' : 'warning'}>{eligibilityLabels[price.eligibility]}</Badge></td>
      </tr>)}</tbody>
    </Table></TableWrap>}
    <Footnote>가격 유효기간: {prices.maxAgeHours}시간. 적정가 반영에는 카드 속성과 별도의 USDC 환율 근거 확인이 필요합니다.</Footnote>
  </Section>;
}

const Section = styled.section({ marginTop: 0, paddingTop: 0 });
const Heading = styled.div({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 12, '& h2': { fontSize: 24 } });
const Description = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 14, marginBottom: 20 }));
const TableWrap = styled.div(({ theme }) => ({ background: theme.color.surface, overflowX: 'auto', borderTop: `1px solid ${theme.color.line}` }));
const Table = styled.table(({ theme }) => ({ width: '100%', borderCollapse: 'collapse', fontSize: 14, '& th,& td': { padding: '16px 12px', borderBottom: `1px solid ${theme.color.line}`, textAlign: 'left', verticalAlign: 'top' }, '& th': { background: theme.color.lavenderSoft, color: theme.color.muted, fontWeight: 500 }, '& td': { overflowWrap: 'anywhere' },
  '@media(max-width:767px)': { display: 'block', '& thead': { position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }, '& tbody,& tr,& td': { display: 'block' }, '& tr': { padding: 16, borderBottom: `1px solid ${theme.color.line}` }, '& td': { padding: '5px 0', border: 0 }, '& td::before': { content: 'attr(data-label)', display: 'inline-block', minWidth: 96, color: theme.color.muted, fontWeight: 400 } },
}));
const Amount = styled.td({ whiteSpace: 'nowrap', fontWeight: 750, fontVariantNumeric: 'tabular-nums' });
const Small = styled.span(({ theme }) => ({ display: 'block', marginTop: 4, color: theme.color.muted, fontSize: 12 }));
const Evidence = styled.details(({ theme }) => ({ maxWidth: 320, marginTop: 4, fontSize: 12, overflowWrap: 'anywhere', '& summary': { cursor: 'pointer', minHeight: 44, paddingBlock: 12, color: theme.color.link }, '& p': { marginBlock: 8, color: theme.color.muted }, '& a': { display: 'inline-block', paddingBlock: 5 } }));
const Footnote = styled.p(({ theme }) => ({ marginTop: 16, color: theme.color.muted, fontSize: 13 }));
