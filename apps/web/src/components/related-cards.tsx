'use client';

import Link from 'next/link';
import styled from '@emotion/styled';
import type { CardVariant } from '@tcg/contracts';
import { CardImage } from './card-image';
import { getCardDisplayName, formatSet } from '../lib/formatters';

export function RelatedCards({ card, cards, query, failed }: { card: CardVariant; cards: CardVariant[]; query: string; failed: boolean }) {
  return <Section aria-labelledby="related-heading"><Heading><h2 id="related-heading">{getCardDisplayName(card)} 카드 더 보기</h2><Link href={`/cards?${new URLSearchParams({ q: card.name })}`}>이름으로 검색하기</Link></Heading>
    {cards.length > 0 ? <Cards>{cards.map(item => <CardLink key={item.id} href={`/cards/${item.id}${query ? `?${new URLSearchParams({ q: query })}` : ''}`} aria-label={`${getCardDisplayName(item)} ${formatSet(item.setCode)} ${item.cardNumber} 상세 보기`}><Thumbnail><CardImage card={item} variant="thumbnail" /></Thumbnail><div><strong>{formatSet(item.setCode)}</strong><span>카드 번호 {item.cardNumber} / {item.language}</span></div></CardLink>)}</Cards> : <Note>{failed ? '다른 카드를 불러오지 못했어요. 이름으로 다시 검색해 주세요.' : '이번 검색에서는 다른 카드를 찾지 못했어요.'}</Note>}
  </Section>;
}

const Section = styled.section(({ theme }) => ({ borderTop: `1px solid ${theme.color.line}`, paddingTop: 24, marginTop: 48 }));
const Heading = styled.div(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, '& h2': { fontSize: 18, fontWeight: 550 }, '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 44, fontSize: 13, color: theme.color.ink } }));
const Cards = styled.div({ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 24, marginTop: 16, '@media(max-width:767px)': { gridTemplateColumns: 'minmax(0,1fr)' } });
const CardLink = styled(Link)(({ theme }) => ({ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0, color: theme.color.ink, textDecoration: 'none', '& strong': { display: 'block', fontSize: 14, fontWeight: 550 }, '& span': { display: 'block', color: theme.color.muted, fontSize: 12, marginTop: 6 }, '&:hover strong': { textDecoration: 'underline' } }));
const Thumbnail = styled.div({ width: 72, flexShrink: 0 });
const Note = styled.p(({ theme }) => ({ fontSize: 13, color: theme.color.muted, marginTop: 12 }));
