'use client';

import type { Currency } from '@tcg/contracts/payment-profile';
import Link from 'next/link';
import styled from '@emotion/styled';

export function SellerProceedsNote({ currency = 'USDC' }: { currency?: Currency }) {
  return <ProceedsNote><strong>판매 대금 안내</strong><p>현재 MVP에서는 구매자의 테스트 {currency}를 플랫폼 수납 지갑으로 받아요. 판매자 수익은 소유권 이전까지 완료된 Trade를 한 번씩 집계하며, 판매자 지갑으로 지급하거나 출금할 수 있는 {currency} 잔액이 아니에요.</p></ProceedsNote>;
}

export function SellerGuide({ currency = 'USDC', live = false }: { currency?: Currency; live?: boolean }) {
  return <Guide aria-labelledby="seller-guide-heading"><GuideHeading><div><h2 id="seller-guide-heading">보유 카드는 직접 판매 등록해요</h2><p>구매는 에이전트에게 맡기고, 판매할 카드와 가격은 내가 정해요.</p></div><Link href="/collection#owned-cards">판매할 카드 선택하기</Link></GuideHeading><Steps>
    <li><h3>보유 카드 선택</h3><p>내 카드에서 ‘보유 중’인 카드를 골라요.</p></li>
    <li><h3>고정가 등록</h3><p>{currency} 판매 가격을 정해 매물을 등록해요.</p></li>
    <li><h3>예약·결제 확인</h3><p>구매 예약 후에는 변경을 멈추고 결제 확인을 기다려요.</p></li>
    <li><h3>판매 완료</h3><p>정산 확인 후 카드가 이전되고 거래 내역에 남아요.</p></li>
  </Steps><SellerProceedsNote currency={currency} /><GuideNote>{live ? '판매 등록과 취소는 내 카드와 매물 화면에서 진행해요. 구매자의 결제가 확인되면 보유 카드와 거래 내역에 반영돼요.' : '화면 미리보기의 판매 등록은 예시이며 실제 결제나 소유권 이전을 실행하지 않아요.'}</GuideNote></Guide>;
}

const Guide = styled.section(({ theme }) => ({ borderTop: `1px solid ${theme.color.line}`, padding: '32px 0', '& h2': { fontSize: 24, fontWeight: 550, letterSpacing: '-.03em' } }));
const GuideHeading = styled.div(({ theme }) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 16, '& p': { color: theme.color.muted, fontSize: 14, lineHeight: 1.8, marginTop: 10 }, '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 44, color: theme.color.link, fontSize: 14, textUnderlineOffset: 4 } }));
const Steps = styled.ol(({ theme }) => ({ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 24, listStylePosition: 'inside', margin: '28px 0', padding: 0, '& li': { color: theme.color.muted, fontSize: 13 }, '& h3': { display: 'inline', marginLeft: 6, fontSize: 15, color: theme.color.ink, fontWeight: 600 }, '& p': { marginTop: 10, lineHeight: 1.8 }, '@container browse (max-width:760px)': { gridTemplateColumns: 'repeat(2,minmax(0,1fr))' }, '@container browse (max-width:400px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 20 } }));
const ProceedsNote = styled.div(({ theme }) => ({ borderLeft: `3px solid ${theme.color.input}`, padding: '4px 0 4px 16px', marginBlock: 20, '& strong': { fontSize: 14, color: theme.color.ink, fontWeight: 600 }, '& p': { color: theme.color.muted, fontSize: 13, lineHeight: 1.85, marginTop: 8, maxWidth: 850 } }));
const GuideNote = styled.p(({ theme }) => ({ fontSize: 12, color: theme.color.muted, lineHeight: 1.8, marginTop: 16 }));
