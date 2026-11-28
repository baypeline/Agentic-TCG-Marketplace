'use client';

import Link from 'next/link';
import styled from '@emotion/styled';
import type { CardVariant, Valuation, MarketPricesResponse } from '@tcg/contracts';
import { CardImage } from '../../components/card-image';
import { ValuationDetails } from '../../components/valuation-details';
import { MarketPrices } from '../../components/market-prices';
import { RequestState } from '../../components/request-state';
import { Badge } from '../../components/ui';
import { RelatedCards } from '../../components/related-cards';
import { getValuationStatus } from '../../lib/valuation-status';
import { getValuationLabel } from '../../lib/formatters';
import { getCardDisplayName, formatSet, formatAttribute, formatUsdc, getReferencePrice, formatProvider, formatVariant, formatUtc, eligibilityLabels } from '../../lib/formatters';

export function DetailView({ card, valuation, prices, query, related = [], relatedFailed = false }: { card: CardVariant; valuation: Valuation | null; prices: MarketPricesResponse | null; query: string; related?: CardVariant[]; relatedFailed?: boolean }) {
  const backHref = query ? `/cards?${new URLSearchParams({ q: query })}` : '/cards';
  const reference = getReferencePrice(prices);
  const available = valuation?.status === 'AVAILABLE';
  const isDemo = valuation?.methodology === 'DEMO_USD_REFERENCE';
  const valuationStatus = valuation ? getValuationStatus(valuation, prices, card) : null;
  return <>
    <BackNav aria-label="카드 탐색"><Link href={backHref}>← {query ? `“${query}” 검색 결과` : '카드 둘러보기'}</Link><span>{formatSet(card.setCode)}</span></BackNav>
    <DetailLayout><ImageColumn><CardImage card={card} variant="detail" /></ImageColumn>
      <Info><Title>{getCardDisplayName(card)}</Title>{getCardDisplayName(card) !== card.name && <Original>{card.name}</Original>}
        <PriceOverview aria-label="대표 가격 정보"><PriceLabel>{available ? getValuationLabel(valuation) : reference ? '해외 참고 시세' : '평가 정보'}</PriceLabel>
          <MainPrice>{available ? formatUsdc(valuation.estimatedPrice, valuation.currency) : reference ? `${reference.originalAmount} ${reference.originalCurrency}` : valuation ? '평가 자료 부족' : '가격 조회 실패'}</MainPrice>
          {available ? <PriceStatus>{valuation.dataSource === 'MOCK' ? <Badge tone="demo">시연용 합성 데이터</Badge> : isDemo ? <Badge tone="demo">시장 데이터 · USD 데모 환산</Badge> : `검증 표본 ${valuation.sampleSize}개 · 신뢰 수준 낮음`}</PriceStatus> : reference ? <><PriceStatus>{formatProvider(reference.provider)} / {formatVariant(reference.providerVariant)} · {eligibilityLabels[reference.eligibility]}</PriceStatus><Updated>갱신 {formatUtc(reference.observedAt)} UTC</Updated></> : <PriceStatus>사용 가능한 가격을 확인한 뒤 표시합니다.</PriceStatus>}
          {reference && !available && <Caveat>위 금액은 제공자의 원본 참고 가격입니다. 개별 체결가나 USDC 적정가가 아닙니다.</Caveat>}
          {available && valuation.dataSource === 'MOCK' && <Caveat>실제 시장가격이나 구매 판단에 사용할 수 없습니다.</Caveat>}
          {available && isDemo && <Caveat>1 USD ≈ 1 USDC 데모 환산 · 판본·보존 상태 미보정</Caveat>}
          {valuationStatus && <Caveat><strong>{valuationStatus.title}</strong><br />{valuationStatus.reasons[0]} <a href="#valuation-details">평가 근거 확인</a></Caveat>}
        </PriceOverview>
        <Facts><div><dt>인쇄 언어</dt><dd>{card.language}</dd></div><div><dt>카드 번호</dt><dd>{card.cardNumber}</dd></div><div><dt>에디션</dt><dd>{formatAttribute(card.edition)}</dd></div><div><dt>보존 상태</dt><dd>{formatAttribute(card.condition)}</dd></div></Facts>
      </Info>
    </DetailLayout>
    <RelatedCards card={card} cards={related} query={query} failed={relatedFailed} />
    <SectionNav aria-label="카드 상세 정보"><a href="#market-data">참고 시세</a><a href="#valuation-details">평가 근거</a><a href="#card-notes">카드 정보</a></SectionNav>
    <MarketSection id="market-data">{prices ? <MarketPrices prices={prices} demoValuation={isDemo} /> : <RequestState compact title="참고 시세를 불러오지 못했습니다." message="가격 자료의 유무를 확인하지 못했습니다. 잠시 후 다시 시도하세요." />}</MarketSection>
    <Evaluation id="valuation-details" open={valuation?.status === 'INSUFFICIENT_DATA'}><summary>{valuation?.currency ?? 'USDC'} 평가와 근거 확인</summary><EvaluationContent>{valuation ? <ValuationDetails valuation={valuation} prices={prices} card={card} /> : <RequestState compact title="평가 정보를 불러오지 못했습니다." message="카드 정보는 확인할 수 있습니다. 잠시 후 다시 시도하세요." />}</EvaluationContent></Evaluation>
    <CardNotes id="card-notes"><h2>카드 정보</h2><p>{card.language === 'KO' ? 'TCGdex 한국어 카탈로그의 이름을 표시합니다. 실제 카드의 이름과 세트·번호를 함께 확인해 주세요.' : '한국어 표기는 포켓몬 종명이며 한국어판 카드의 정식 제목과는 다를 수 있습니다. 카드의 인쇄 언어는 별도로 확인하세요.'}</p><details><summary>카드 식별 정보</summary><code>{card.id}</code></details></CardNotes>
  </>;
}

const BackNav = styled.nav(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 20, marginBottom: 36, fontSize: 13, color: theme.color.muted, '& a': { display: 'inline-flex', minHeight: 44, alignItems: 'center', color: theme.color.ink, textDecoration: 'none', overflowWrap: 'anywhere' }, '& a:hover': { textDecoration: 'underline' } }));
const DetailLayout = styled.div({ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,.85fr)', gap: 64, alignItems: 'start', maxWidth: 1120, margin: '0 auto', '@container browse (max-width:740px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 36 }, '@media(max-width:899px)': { gap: 40 }, '@media(max-width:767px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 36 } });
const ImageColumn = styled.div({ paddingBlock: 8, '@media(min-width:768px)': { position: 'sticky', top: 80 }, '@container browse (max-width:740px)': { position: 'static' } });
const Info = styled.section({ minWidth: 0, paddingBlock: 8 });
const Title = styled.h1({ fontSize: 'clamp(30px,3.2vw,42px)', fontWeight: 550, letterSpacing: '-.035em', overflowWrap: 'anywhere' });
const Original = styled.p(({ theme }) => ({ fontSize: 15, color: theme.color.muted, marginTop: 8 }));
const PriceOverview = styled.div(({ theme }) => ({ margin: '32px 0 28px', paddingBottom: 28, borderBottom: `1px solid ${theme.color.line}` }));
const PriceLabel = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 13 }));
const MainPrice = styled.p({ fontSize: 'clamp(28px,3vw,38px)', fontWeight: 650, letterSpacing: '-.025em', fontVariantNumeric: 'tabular-nums', margin: '6px 0 12px', overflowWrap: 'anywhere' });
const PriceStatus = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 13 }));
const Updated = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 12, marginTop: 6 }));
const Caveat = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 13, marginTop: 16, maxWidth: 410 }));
const Facts = styled.dl(({ theme }) => ({ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '20px 24px', margin: 0, '& dt': { color: theme.color.muted, fontSize: 12, marginBottom: 4 }, '& dd': { margin: 0, fontSize: 14, fontWeight: 500, overflowWrap: 'anywhere' } }));
const SectionNav = styled.nav(({ theme }) => ({ display: 'flex', gap: 32, borderBottom: `1px solid ${theme.color.line}`, margin: '56px 0 28px', '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 52, color: theme.color.ink, textDecoration: 'none', fontSize: 14, fontWeight: 600 }, '& a:first-of-type': { borderBottom: `2px solid ${theme.color.coral}` }, '& a:hover': { color: theme.color.link } }));
const MarketSection = styled.section({ scrollMarginTop: 112 });
const Evaluation = styled.details(({ theme }) => ({ borderTop: `1px solid ${theme.color.line}`, marginTop: 36, paddingTop: 8, scrollMarginTop: 112, '& > summary': { minHeight: 56, paddingBlock: 16, cursor: 'pointer', fontWeight: 600, fontSize: 16 } }));
const EvaluationContent = styled.div({ maxWidth: 720, padding: '12px 0 24px' });
const CardNotes = styled.section(({ theme }) => ({ marginTop: 28, borderTop: `1px solid ${theme.color.line}`, paddingTop: 28, scrollMarginTop: 112, '& h2': { fontSize: 18, fontWeight: 600 }, '& p': { marginTop: 12, fontSize: 13, color: theme.color.muted, maxWidth: 720 }, '& details': { marginTop: 12, color: theme.color.muted, fontSize: 12 }, '& summary': { minHeight: 44, paddingBlock: 10, cursor: 'pointer' }, '& code': { overflowWrap: 'anywhere' } }));
