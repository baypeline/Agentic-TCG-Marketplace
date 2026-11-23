'use client';

import styled from '@emotion/styled';
import type { Valuation } from '@tcg/contracts';
import { formatUsdc, formatUtc } from '../lib/formatters';
import { Badge, Notice } from './ui';

export function ValuationDetails({ valuation }: { valuation: Valuation }) {
  const isMock = valuation.dataSource === 'MOCK';
  return <Panel aria-labelledby="valuation-heading">
    <PanelHeader><h2 id="valuation-heading">{isMock ? '데모 가격' : '추정 적정가'}</h2><Badge tone={isMock ? 'demo' : 'neutral'}>{isMock ? 'Mock / 합성 데이터' : '시장 데이터'}</Badge></PanelHeader>
    <Price>{valuation.status === 'AVAILABLE' ? formatUsdc(valuation.estimatedPrice) : '평가 자료 부족'}</Price>
    {valuation.status === 'INSUFFICIENT_DATA' && <Description>평가에 사용할 표본이 없어 가격을 제공하지 않습니다.</Description>}
    {isMock && <Notice title="시연용 합성 가격" tone="demo">실제 시장가격이나 구매 판단에 사용할 수 없습니다.</Notice>}
    <Facts>
      <dt>가격 표본 수</dt><dd>{valuation.sampleSize}개</dd><dt>신뢰 수준</dt><dd>{{ LOW: '낮음', MEDIUM: '보통', HIGH: '높음' }[valuation.confidence]}</dd>
      {valuation.latestObservedAt && <><dt>최근 표본 (UTC)</dt><dd><time dateTime={valuation.latestObservedAt}>{formatUtc(valuation.latestObservedAt)}</time></dd></>}
      <dt>평가 시각 (UTC)</dt><dd><time dateTime={valuation.evaluatedAt}>{formatUtc(valuation.evaluatedAt)}</time></dd>
    </Facts>
    <Sources><summary>평가 출처와 기준 보기</summary>
      {valuation.sourceSummary?.length ? <ul>{valuation.sourceSummary.map(source => <li key={source}>{source}</li>)}</ul> : <p>제공된 출처 없음</p>}
      <p>평가 시각은 계산 시점입니다. 가격 표본의 최신성이나 실제 거래 가능 가격을 보장하지 않습니다.</p>
      {!isMock && <p>표본 수는 검증된 제공자 집계 가격의 수이며 실제 체결 건수가 아닙니다. 제공자별 최신 표본을 최대 한 개씩 사용하며 신뢰 수준은 낮음으로 유지합니다.</p>}
    </Sources>
  </Panel>;
}

const Panel = styled.section(({ theme }) => ({ padding: 24, background: theme.color.surface, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.panel, '@media(max-width:639px)': { padding: 20 } }));
const PanelHeader = styled.div({ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 10, '& h2': { fontSize: 16 } });
const Price = styled.p({ fontSize: 'clamp(24px, 3vw, 32px)', fontWeight: 800, fontVariantNumeric: 'tabular-nums', margin: '16px 0', overflowWrap: 'anywhere' });
const Description = styled.p(({ theme }) => ({ fontSize: 14, color: theme.color.muted, marginBottom: 16 }));
const Facts = styled.dl(({ theme }) => ({ display: 'grid', gridTemplateColumns: '108px minmax(0,1fr)', gap: '8px 16px', margin: '24px 0 0', fontSize: 14, '& dt': { color: theme.color.muted }, '& dd': { margin: 0, overflowWrap: 'anywhere', fontVariantNumeric: 'tabular-nums' }, '@media(max-width:639px)': { columnGap: 8 } }));
const Sources = styled.details(({ theme }) => ({ marginTop: 20, borderTop: `1px solid ${theme.color.line}`, paddingTop: 12, color: theme.color.muted, fontSize: 13, '& summary': { cursor: 'pointer', minHeight: 44, paddingBlock: 10, color: theme.color.ink, fontWeight: 650 }, '& ul': { paddingLeft: 18 }, '& li': { overflowWrap: 'anywhere' }, '& p': { marginTop: 10 } }));
