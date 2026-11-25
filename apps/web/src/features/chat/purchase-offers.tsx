'use client';

import styled from '@emotion/styled';
import Link from 'next/link';
import type { AgentPurchaseOffer, AgentPurchaseProgress } from '@tcg/contracts';
import { formatUsdc, getCardDisplayName, formatSet } from '../../lib/formatters';

export function PurchaseOffers({ offers, disabled, completedIds, submittedIds, onBuy, signingMode = 'browser', payer }: { signingMode?: 'browser' | 'server'; payer?: string | null; offers: AgentPurchaseOffer[]; disabled: boolean; completedIds: string[]; submittedIds: string[]; onBuy: (offer: AgentPurchaseOffer) => void }) {
  return <Offers aria-label="구매 가능한 데모 매물"><Hint>카드·가격은 합성 데모 데이터예요. 구매하면 Base Sepolia 테스트 USDC가 실제 전송돼요.</Hint>{signingMode === 'server' && <Hint>에이전트 전용 지갑이 건당 0.025 USDC, 총예산 0.1 USDC 정책 범위에서 자동 서명해요. 구매 버튼을 누르면 전송합니다.{payer && <> 지급 지갑: {payer.slice(0, 6)}…{payer.slice(-4)}</>}</Hint>}{offers.map(offer => <Offer key={offer.listingId}><div><strong>{getCardDisplayName(offer.card)}</strong><small>{formatSet(offer.card.setCode)} · {offer.card.cardNumber} · {offer.card.language}</small></div><Price>{formatUsdc(offer.price)}</Price><Buy type="button" disabled={disabled || !offer.paymentReady || completedIds.includes(offer.listingId)} onClick={() => onBuy(offer)}>{completedIds.includes(offer.listingId) ? '구매 완료' : !offer.paymentReady ? '결제 설정 필요' : submittedIds.includes(offer.listingId) ? '기존 결제 확인' : signingMode === 'server' ? '에이전트 지갑으로 구매' : '지갑으로 구매'}</Buy></Offer>)}</Offers>;
}

export function PurchaseReceipt({ progress, disabled, onCheck }: { progress: AgentPurchaseProgress; disabled: boolean; onCheck: () => void }) {
  return <Receipt role="status"><strong>{progress.status === 'COMPLETED' ? '구매가 완료됐어요.' : progress.status === 'PENDING' ? '결제·체결을 확인하고 있어요.' : progress.status === 'FAILED' ? '결제가 실패했어요.' : '구매를 취소했어요.'}</strong><p>{getCardDisplayName(progress.card)} · {formatUsdc(progress.amount)}</p>{progress.status === 'COMPLETED' && <p>카드 소유권과 거래 내역이 반영됐어요.</p>}{progress.status === 'PENDING' && <><p>새 지급 없이 기존 결제를 확인합니다. 거래 관리에서도 상태를 볼 수 있어요.</p><Buy type="button" disabled={disabled} onClick={onCheck}>기존 결제 상태 확인</Buy></>}{progress.transactionHash && <a href={`https://sepolia.basescan.org/tx/${progress.transactionHash}`} target="_blank" rel="noopener noreferrer">Base Sepolia 결제 확인</a>}<Link href="/collection">내 카드 보기</Link><Link href="/activity">거래 내역 보기</Link></Receipt>;
}

const Offers = styled.div({ display: 'grid', gap: 10, marginTop: 16 });
const Hint = styled.p(({ theme }) => ({ fontSize: 12, lineHeight: 1.7, color: theme.color.muted }));
const Offer = styled.div(({ theme }) => ({ display: 'grid', gap: 8, padding: 12, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.control, '& strong': { display: 'block', fontSize: 14 }, '& small': { display: 'block', fontSize: 12, color: theme.color.muted, marginTop: 4 } }));
const Price = styled.span({ fontWeight: 650, fontVariantNumeric: 'tabular-nums' });
const Buy = styled.button(({ theme }) => ({ minHeight: 44, padding: '10px 14px', border: 0, borderRadius: theme.radius.control, background: theme.color.primary, color: theme.color.surface, '&:disabled': { opacity: .5, cursor: 'default' } }));
const Receipt = styled.div(({ theme }) => ({ marginTop: 12, padding: 14, fontSize: 13, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.control, '& p': { marginTop: 6 }, '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 44, marginRight: 12, color: theme.color.link, textDecoration: 'underline' } }));
