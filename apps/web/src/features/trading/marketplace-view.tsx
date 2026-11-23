'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Button } from '../../components/ui';
import { formatUsdc, getCardDisplayName } from '../../lib/formatters';
import { useDemoTrading } from './demo-provider';
import { demoUserId, parseUsdcInput, usdcDecimal } from './demo-model';
import { previewCards } from './demo-cards';
import { SellerProceedsNote } from './seller-guide';
import { Actions, CardCell, EmptyRows, Field, Filters, PreviewPage, QuietButton, RecordTable, ResultNote, Section, StateBadge } from './trading-ui';

export function MarketplaceView({ initialOwner = 'ALL' }: { initialOwner?: 'ALL' | 'MINE' }) {
  const { state, dispatch } = useDemoTrading();
  const [filter, setFilter] = useState('ACTIVE');
  const [owner, setOwner] = useState<string>(initialOwner);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { if (selected) document.getElementById('order-price')?.focus(); }, [selected]);
  const listing = state.listings.find(row => row.id === selected && row.status === 'ACTIVE');
  const rows = state.listings.filter(row => (owner === 'ALL' || (owner === 'MINE' ? row.sellerId === demoUserId : row.sellerId !== demoUserId)) && (filter === 'ALL' || row.status === filter) && previewCards.some(card => card.id === row.cardVariantId && `${card.name} ${getCardDisplayName(card)}`.toLowerCase().includes(query.trim().toLowerCase())));
  function createOrder(event: FormEvent) {
    event.preventDefault(); const amount = parseUsdcInput(price);
    if (!amount) { setError('0보다 큰 금액을 소수점 6자리 이내로 입력해 주세요.'); return; }
    if (!listing) return;
    dispatch({ type: 'CREATE_ORDER', cardId: listing.cardVariantId, amount, id: crypto.randomUUID() }); setSelected(''); setError(''); setNotice('구매 주문을 미리보기에 추가했어요. 매칭이나 결제는 실행하지 않았어요. 거래 관리에서 확인할 수 있어요.');
  }
  return <PreviewPage title="고정가 매물" description="구매할 매물을 살펴보거나 내가 등록한 매물을 관리해요. 판매 카드는 내 카드에서 직접 등록할 수 있어요." actions={<><Link href="/collection#owned-cards">판매할 카드 선택</Link><Link href="/activity">거래 관리</Link></>}>
    <SellerProceedsNote />
    <Filters><label>매물 구분<select value={owner} onChange={e => setOwner(e.target.value)}><option value="ALL">전체 매물</option><option value="MINE">내 매물</option><option value="OTHERS">다른 판매자 매물</option></select></label></Filters>
    <Filters><label>카드 이름<input value={query} onChange={e => setQuery(e.target.value)} placeholder="카드 이름 검색" /></label><label>매물 상태<select value={filter} onChange={e => setFilter(e.target.value)}><option value="ALL">전체</option><option value="ACTIVE">판매 중</option><option value="RESERVED">예약 중</option><option value="SOLD">판매 완료</option><option value="CANCELLED">취소</option></select></label></Filters>
    <RecordTable label={`예시 매물 ${rows.length}건`} headings={['카드', '판매자', '고정가', '상태', '관리']}>
      {rows.map(row => <tr key={row.id}>
        <td data-label="카드"><CardCell id={row.cardVariantId} /></td><td data-label="판매자">{row.sellerId === demoUserId ? '내 매물' : `판매자 ${row.sellerId.slice(-1)} (예시)`}</td><td data-label="고정가">{formatUsdc(row.price)}</td><td data-label="상태"><StateBadge status={row.status === 'ACTIVE' ? 'LISTED' : row.status} /></td>
        <td data-label="관리">{row.status === 'ACTIVE' && (row.sellerId === demoUserId ? <><QuietButton type="button" onClick={() => { dispatch({ type: 'CANCEL_LISTING', id: row.id }); setNotice('내 매물의 등록 취소 상태를 반영했어요. 실제 등록은 변경되지 않아요.'); }}>등록 취소</QuietButton><ResultNote>가격 변경은 취소 후 재등록해 주세요.</ResultNote></> : <QuietButton type="button" onClick={() => { setSelected(row.id); setPrice(usdcDecimal(row.price)); setError(''); setNotice(''); }}>주문 작성</QuietButton>)}
          {row.status === 'RESERVED' && <ResultNote>예약·결제 확인 중이에요. 새 주문과 수정·취소는 할 수 없어요.</ResultNote>}
          {row.status === 'SOLD' && (row.sellerId === demoUserId ? <Link href="/activity?view=trades">완료된 거래 확인</Link> : <ResultNote>판매가 끝난 매물이에요.</ResultNote>)}
          {row.status === 'CANCELLED' && (row.sellerId === demoUserId ? <Link href="/collection#owned-cards">내 카드에서 다시 등록</Link> : <ResultNote>판매자가 등록을 취소했어요.</ResultNote>)}
        </td></tr>)}
    </RecordTable>{!rows.length && <EmptyRows text="조건에 맞는 매물이 없어요. 매물 구분·상태·검색어를 바꿔 보세요." />}
    <ResultNote>판매 중인 내 매물은 등록을 취소할 수 있어요. 가격을 바꾸려면 취소 후 내 카드에서 다시 등록해 주세요. 예약 중에는 수정·취소 없이 결제 확인을 기다리고, 판매 완료 후에는 거래 내역을 확인해 주세요. 미리보기 상태는 자동으로 갱신되지 않아요.</ResultNote>
    {listing && <Section><h2>구매 주문 미리보기</h2><CardCell id={listing.cardVariantId} /><ResultNote>이 금액을 Agent 구매 주문의 상한으로 기록해요. 즉시 구매나 결제는 진행하지 않아요.</ResultNote><form onSubmit={createOrder} noValidate><Field id="order-price" label="최대 구매 가격 (USDC)" error={error}><input id="order-price" inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={error ? 'order-price-error' : undefined} /></Field><Actions><Button type="submit">주문 추가 (미리보기)</Button><QuietButton type="button" onClick={() => { setSelected(''); setError(''); }}>닫기</QuietButton></Actions></form></Section>}
    <ResultNote role="status">{notice}</ResultNote>
  </PreviewPage>;
}
