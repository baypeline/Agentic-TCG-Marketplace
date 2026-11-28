'use client';

import Link from 'next/link';
import Form from 'next/form';
import styled from '@emotion/styled';
import { CardImage } from '../../components/card-image';
import { getCardDisplayName, formatSet, formatUsdc, getReferencePrice, eligibilityLabels, getValuationLabel, type CatalogItem } from '../../lib/formatters';

export function CatalogView({ items, query }: { items: CatalogItem[]; query: string }) {
  return <CatalogLayout>
    <SearchHeader><Title>카드 검색</Title>
      <SearchForm action="/cards" role="search"><label htmlFor="query">카드 이름</label><SearchBox><SearchInput key={query} id="query" name="q" defaultValue={query} maxLength={200} placeholder="한국어 또는 영문" /><SearchButton type="submit" aria-label="카드 검색"><SearchIcon viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.7" /><path d="m16 16 4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></SearchIcon></SearchButton></SearchBox></SearchForm>
      {query && <ClearLink href="/cards">검색 초기화</ClearLink>}
    </SearchHeader>
    <Results><ResultBar><h2 id="results-heading">{query ? `“${query}” 검색 결과` : '카드 둘러보기'}</h2><ResultCount>{items.length}종 조회</ResultCount></ResultBar>
    <section aria-labelledby="results-heading">{items.length ? <Grid>{items.map((item, index) => <CardTile key={item.card.id} item={item} query={query} priority={index < 4} />)}</Grid> : <Empty><h3>검색 결과가 없습니다.</h3><p>다른 이름으로 검색하거나 검색 조건을 초기화하세요.</p><Link href="/cards">검색 초기화</Link></Empty>}</section>
    <ScopeNote>한 번에 최대 20종을 조회합니다. 원하는 카드가 보이지 않으면 이름으로 검색하세요.</ScopeNote>
    </Results>
  </CatalogLayout>;
}

function CardTile({ item, query, priority }: { item: CatalogItem; query: string; priority: boolean }) {
  const { card, valuation } = item;
  const reference = getReferencePrice(item.prices);
  const available = valuation?.status === 'AVAILABLE';
  const label = available ? getValuationLabel(valuation) : reference ? '해외 참고 시세' : '평가 정보';
  const amount = available ? formatUsdc(valuation.estimatedPrice, valuation.currency) : reference ? `${reference.originalAmount} ${reference.originalCurrency}` : item.valuationFailed ? '가격 조회 실패' : '평가 자료 부족';
  return <Tile href={`/cards/${card.id}${query ? `?${new URLSearchParams({ q: query })}` : ''}`} aria-label={`${getCardDisplayName(card)} 상세 보기`}>
    <CardImage card={card} priority={priority} /><TileText><h3>{getCardDisplayName(card)}</h3><CardMeta>{formatSet(card.setCode)} / {card.cardNumber}<span>{card.language}</span></CardMeta>
      <PriceLine title={!available && reference ? eligibilityLabels[reference.eligibility] : undefined}><span>{label}</span><strong>{amount}</strong></PriceLine>
      {item.valuationFailed && reference && <Secondary>평가 정보 조회 실패</Secondary>}
      {item.pricesFailed && !available && <Secondary>참고 시세 조회 실패</Secondary>}
      {reference && !available && ['STALE_PRICE', 'STALE_FX', 'VARIANT_MISMATCH'].includes(reference.eligibility) && <Secondary>{eligibilityLabels[reference.eligibility]}</Secondary>}
      {reference && !available && <AccessibleNote>{eligibilityLabels[reference.eligibility]} · 자세한 근거는 상세에서 확인하세요.</AccessibleNote>}
    </TileText>
  </Tile>;
}

const CatalogLayout = styled.div({ display: 'grid', gridTemplateColumns: '200px minmax(0,1fr)', gap: 56, paddingTop: 12, '@container browse (max-width:720px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 28 }, '@media(max-width:1023px)': { gap: 36 }, '@media(max-width:767px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 28, paddingTop: 0 } });
const Results = styled.div({ minWidth: 0 });
const SearchHeader = styled.aside({ position: 'sticky', top: 80, alignSelf: 'start', minWidth: 0, '@container browse (max-width:720px)': { position: 'static' }, '@media(max-width:767px)': { position: 'static' } });
const Title = styled.h1({ fontSize: 26, fontWeight: 600, letterSpacing: '-.035em', marginBottom: 32, '@media(max-width:767px)': { marginBottom: 20 } });
const SearchForm = styled(Form)({ '& label': { display: 'block', fontSize: 13, marginBottom: 8 } });
const SearchBox = styled.div(({ theme }) => ({ display: 'flex', alignItems: 'center', gap: 4, borderBottom: `1px solid ${theme.color.input}`, '&:focus-within': { borderBottomColor: theme.color.focus } }));
const SearchIcon = styled.svg({ width: 20, height: 20 });
const SearchInput = styled.input(({ theme }) => ({ width: '100%', minWidth: 0, flex: 1, height: 48, padding: '8px 0', border: 0, fontSize: 14, color: theme.color.ink, background: theme.color.surface, '&::placeholder': { color: theme.color.muted } }));
const SearchButton = styled.button(({ theme }) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, minWidth: 44, padding: 8, border: 0, background: theme.color.surface, color: theme.color.ink, '&:hover': { color: theme.color.link } }));
const ResultBar = styled.div(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, minHeight: 48, marginBottom: 24, borderBottom: `1px solid ${theme.color.line}`, '& h2': { fontSize: 16, fontWeight: 500, overflowWrap: 'anywhere' } }));
const ResultCount = styled.span(({ theme }) => ({ fontSize: 13, color: theme.color.muted }));
const ClearLink = styled(Link)({ display: 'inline-flex', alignItems: 'center', fontSize: 13, minHeight: 44, marginTop: 8 });
const Grid = styled.div({ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '40px 32px', '@container browse (max-width:1100px)': { gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }, '@media(max-width:1099px)': { gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '36px 24px' }, '@media(max-width:767px)': { gap: '32px 20px' }, '@media(max-width:359px)': { gap: '28px 12px' } });
const Tile = styled(Link)(({ theme }) => ({ position: 'relative', display: 'block', minWidth: 0, width: '100%', maxWidth: 240, marginInline: 'auto', color: theme.color.ink, textDecoration: 'none', '&:hover h3,&:focus-visible h3': { color: theme.color.link, textDecoration: 'underline' }, '&:focus-visible': { outlineOffset: 6 } }));
const TileText = styled.div({ paddingTop: 20, '& h3': { fontSize: 19, fontWeight: 550, overflowWrap: 'anywhere' }, '@media(max-width:639px)': { paddingTop: 14, '& h3': { fontSize: 16 } } });
const CardMeta = styled.p(({ theme }) => ({ display: 'flex', justifyContent: 'space-between', gap: 8, color: theme.color.muted, fontSize: 12, marginTop: 4, '& > span': { flexShrink: 0 } }));
const PriceLine = styled.p(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: '4px 12px', marginTop: 10, fontVariantNumeric: 'tabular-nums', '& > span': { color: theme.color.muted, fontSize: 12 }, '& strong': { fontSize: 16, fontWeight: 650 }, '@media(max-width:639px)': { display: 'block', '& > span': { display: 'block' }, '& strong': { display: 'block', marginTop: 3, fontSize: 15 } } }));
const Secondary = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 12, marginTop: 6 }));
const AccessibleNote = styled.span({ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)', whiteSpace: 'nowrap' });
const Empty = styled.div(({ theme }) => ({ padding: '64px 0', textAlign: 'center', borderBlock: `1px solid ${theme.color.line}`, '& h3': { fontSize: 22 }, '& p': { color: theme.color.muted, margin: '12px 0' }, '& a': { display: 'inline-flex', padding: 12, minHeight: 44 } }));
const ScopeNote = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 12, marginTop: 32 }));
