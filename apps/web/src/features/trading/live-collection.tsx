'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import styled from '@emotion/styled';
import type { CardVariant, InventoryItem } from '@tcg/contracts';
import { CardImage } from '../../components/card-image';
import { formatAttribute, formatSet, getCardDisplayName } from '../../lib/formatters';
import { StateBadge } from './trading-ui';

export function LiveCollection({ items, cards, renderSale }: {
  items: InventoryItem[];
  cards: CardVariant[];
  renderSale(item: InventoryItem): ReactNode;
}) {
  return <Collection aria-labelledby="owned-cards-heading">
    <CollectionHeading><h2 id="owned-cards-heading">보유 카드 <span>{items.length}</span></h2><Link href="/marketplace?owner=me">내 판매 매물 보기 →</Link></CollectionHeading>
    {!items.length ? <EmptyCollection><h3>아직 보유한 카드가 없어요</h3><p>에이전트로 카드를 찾아 구매하면 여기에 모여요.</p><Link href="/cards">카드 둘러보기 →</Link></EmptyCollection> : <CardGrid>{items.map(item => {
      const card = cards.find(card => card.id === item.cardVariantId);
      const name = card ? getCardDisplayName(card) : '카드 정보 확인 중';
      return <OwnedCard key={item.id}>
        <ArtworkLink href={`/cards/${item.cardVariantId}`} aria-label={`${name} 상세 보기`}>
          {card ? <CardImage card={card} variant="tile" /> : <MissingArtwork>이미지를 불러오지 못했어요</MissingArtwork>}
        </ArtworkLink>
        <CardInfo><CardHeading><h3><Link href={`/cards/${item.cardVariantId}`}>{name}</Link></h3><StateBadge status={item.status} /></CardHeading>
          {card && <><SetName>{formatSet(card.setCode)} · #{card.cardNumber}</SetName><Attributes><div><dt>언어</dt><dd>{({ en: '영어판', ko: '한국어판', ja: '일본어판' } as Record<string, string>)[card.language.toLowerCase()] ?? card.language}</dd></div><div><dt>판본</dt><dd>{formatAttribute(card.edition)}</dd></div><div><dt>상태</dt><dd>{formatAttribute(card.condition)}</dd></div></Attributes></>}
          {item.status === 'AVAILABLE' ? <SaleDetails><summary>판매 등록</summary><SaleContent>{renderSale(item)}</SaleContent></SaleDetails> : <OwnershipNote>{item.status === 'LISTED' ? <>판매 중인 카드예요. <Link href="/marketplace?owner=me">매물 관리 →</Link></> : item.status === 'RESERVED' ? '구매자가 예약한 카드예요. 결제 결과를 기다려 주세요.' : '카드 상세에서 정보를 확인할 수 있어요.'}</OwnershipNote>}
        </CardInfo>
      </OwnedCard>;
    })}</CardGrid>}
  </Collection>;
}

const Collection = styled.section({ marginTop: 36, minWidth: 0 });
const CollectionHeading = styled.div(({ theme }) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginBottom: 24, '& h2': { fontSize: 18, fontWeight: 600 }, '& h2 span': { marginLeft: 8, color: theme.color.muted, fontSize: 15, fontWeight: 400 }, '& > a': { display: 'inline-flex', alignItems: 'center', minHeight: 44, fontSize: 13, textDecoration: 'none', color: theme.color.muted, '&:hover': { color: theme.color.link, textDecoration: 'underline' } } }));
const CardGrid = styled.div({ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))', gap: 24, alignItems: 'start', '@container browse (max-width:600px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 20 } });
const OwnedCard = styled.article(({ theme }) => ({ minWidth: 0, border: `1px solid ${theme.color.line}`, borderRadius: 12, overflow: 'hidden', background: theme.color.surface }));
const ArtworkLink = styled(Link)(({ theme }) => ({ display: 'flex', justifyContent: 'center', padding: '28px 32px', borderBottom: `1px solid ${theme.color.line}`, '& > div': { maxWidth: 190 }, '@container browse (max-width:600px)': { padding: 24, '& > div': { maxWidth: 180 } } }));
const MissingArtwork = styled.div(({ theme }) => ({ aspectRatio: '63 / 88', width: '100%', display: 'grid', placeItems: 'center', color: theme.color.muted, fontSize: 13 }));
const CardInfo = styled.div({ padding: '20px 22px 22px' });
const CardHeading = styled.div(({ theme }) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, '& h3': { fontSize: 19, fontWeight: 600, minWidth: 0, overflowWrap: 'anywhere' }, '& a': { color: theme.color.ink, textDecoration: 'none', '&:hover': { textDecoration: 'underline', textUnderlineOffset: 4 } } }));
const SetName = styled.p(({ theme }) => ({ margin: '6px 0 0', color: theme.color.muted, fontSize: 13 }));
const Attributes = styled.dl(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', gap: '12px 24px', margin: '20px 0', fontSize: 12, '& dt': { color: theme.color.muted, marginBottom: 3 }, '& dd': { margin: 0 } }));
const SaleDetails = styled.details(({ theme }) => ({ '& > summary': { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 44, padding: '8px 12px', border: `1px solid ${theme.color.line}`, borderRadius: 6, listStyle: 'none', cursor: 'pointer', color: theme.color.ink, fontSize: 13, fontWeight: 550, '&::-webkit-details-marker': { display: 'none' }, '&::after': { content: '"+"', marginLeft: 10 }, '&:hover': { borderColor: theme.color.input } }, '&[open] > summary::after': { content: '"−"' } }));
const SaleContent = styled.div({ paddingTop: 20, '& button[type=submit]': { width: '100%' } });
const OwnershipNote = styled.p(({ theme }) => ({ margin: '20px 0 0', fontSize: 13, lineHeight: 1.8, color: theme.color.muted, '& a': { display: 'inline-block', color: theme.color.link } }));
const EmptyCollection = styled.div(({ theme }) => ({ textAlign: 'center', padding: '72px 20px', border: `1px solid ${theme.color.line}`, borderRadius: 12, '& h3': { fontSize: 18, fontWeight: 550 }, '& p': { margin: '12px 0 20px', color: theme.color.muted, fontSize: 14 }, '& a': { display: 'inline-flex', minHeight: 44, alignItems: 'center', color: theme.color.link, fontSize: 14 } }));
