'use client';

import styled from '@emotion/styled';
import { getPaymentProfile } from '@tcg/contracts/payment-profile';
import Link from 'next/link';
import type { AgentPurchaseOffer, AgentPurchaseProgress, agentBudgetStateSchema } from '@tcg/contracts';
import { formatUsdc, getCardDisplayName, formatSet } from '../../lib/formatters';

export function PurchaseOffers({ offers, disabled, completedIds, submittedIds, onBuy, signingMode = 'browser', payer, budget, budgetUnavailable = false, walletBalance }: { budget?: ReturnType<typeof agentBudgetStateSchema.parse>; budgetUnavailable?: boolean; walletBalance?: string | null; signingMode?: 'browser' | 'server'; payer?: string | null; offers: AgentPurchaseOffer[]; disabled: boolean; completedIds: string[]; submittedIds: string[]; onBuy: (offer: AgentPurchaseOffer) => void }) {
  const profile = getPaymentProfile(offers.some(offer => offer.paymentMode !== 'X402_BASE_SEPOLIA') ? 'maroo' : 'base-sepolia');
  const reason = (offer: AgentPurchaseOffer) => {
    if (submittedIds.includes(offer.listingId)) return null;
    if (budgetUnavailable) return '예산 확인 필요';
    if (budget && budget.currency !== (offer.currency ?? profile.currency)) return '결제 통화 확인';
    if (budget && !budget.policy.enabled) return '구매 일시중지';
    if (budget && BigInt(offer.price) > BigInt(budget.policy.maxPerTrade)) return '건당 한도 초과';
    if (budget && BigInt(offer.price) > BigInt(budget.budget.availableAmount)) return '남은 예산 부족';
    if (walletBalance !== null && walletBalance !== undefined && BigInt(walletBalance) < BigInt(offer.price)) return '지갑 충전 필요';
    return null;
  };
  return <Offers aria-label="구매 가능한 매물">
    <Hint>구매 금액 외에 가스비가 발생해요.{profile.chain === 'maroo' && ' 가스비는 구매 지갑에서 함께 지불합니다.'}</Hint>
    {signingMode === 'server' && <Hint>설정한 예산 안에서 에이전트 지갑이 자동 서명해요.{payer && <> 지급 지갑: {payer.slice(0, 6)}…{payer.slice(-4)}</>}</Hint>}
    {budget && <Hint>남은 예산 {formatUsdc(budget.budget.availableAmount, budget.currency)} · 건당 한도 {formatUsdc(budget.policy.maxPerTrade, budget.currency)}</Hint>}
    {walletBalance !== null && walletBalance !== undefined && <Hint>지갑 잔액 {formatUsdc(walletBalance, profile.currency)}</Hint>}
    {(budgetUnavailable || offers.some(offer => reason(offer))) && <Hint><Link href="/agent">충전·예산 설정 확인</Link></Hint>}
    {offers.map(offer => <Offer key={offer.listingId}>
      <div><strong>{getCardDisplayName(offer.card)}</strong><small>{formatSet(offer.card.setCode)} · {offer.card.cardNumber} · {offer.card.language}</small></div>
      {offer.rwa && <Hint>받을 NFT #{offer.rwa.tokenId} · 결제와 소유권 이전을 함께 처리해요.</Hint>}
      <Price>{formatUsdc(offer.price, offer.currency ?? profile.currency)}</Price>
      <Buy type="button" disabled={disabled || !!reason(offer) || !offer.paymentReady || completedIds.includes(offer.listingId)} onClick={() => onBuy(offer)}>{completedIds.includes(offer.listingId) ? '구매 완료' : !offer.paymentReady ? '결제 설정 필요' : submittedIds.includes(offer.listingId) ? '기존 결제 확인' : reason(offer) ?? (signingMode === 'server' ? '에이전트 지갑으로 구매' : '지갑으로 구매')}</Buy>
    </Offer>)}
  </Offers>;
}

export function PurchaseReceipt({ progress, disabled, onCheck }: { progress: AgentPurchaseProgress; disabled: boolean; onCheck: () => void }) {
  const profile = getPaymentProfile(progress.paymentMode !== 'X402_BASE_SEPOLIA' ? 'maroo' : 'base-sepolia');
  return <Receipt role="status"><strong>{progress.status === 'COMPLETED' ? '구매가 완료됐어요.' : progress.status === 'PENDING' ? '결제·체결을 확인하고 있어요.' : progress.status === 'FAILED' ? '결제가 실패했어요.' : '구매를 취소했어요.'}</strong><p>{getCardDisplayName(progress.card)} · {formatUsdc(progress.amount, progress.currency ?? profile.currency)}</p>{progress.status === 'COMPLETED' && <p>카드 소유권과 거래 내역이 반영됐어요.</p>}{progress.status === 'PENDING' && <><p>새 지급 없이 기존 결제를 확인합니다. 거래 관리에서도 상태를 볼 수 있어요.</p><Buy type="button" disabled={disabled} onClick={onCheck}>기존 결제 상태 확인</Buy></>}{progress.transactionHash && <a href={`${profile.explorerUrl}/tx/${progress.transactionHash}`} target="_blank" rel="noopener noreferrer">{profile.chain === 'maroo' ? 'Maroo' : 'Base Sepolia'} 결제 확인</a>}<Link href="/collection">내 카드 보기</Link><Link href="/activity">거래 내역 보기</Link></Receipt>;
}

const Offers = styled.div({ display: 'grid', gap: 10, marginTop: 16 });
const Hint = styled.p(({ theme }) => ({ fontSize: 12, lineHeight: 1.7, color: theme.color.muted }));
const Offer = styled.div(({ theme }) => ({ display: 'grid', gap: 8, padding: 12, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.control, '& strong': { display: 'block', fontSize: 14 }, '& small': { display: 'block', fontSize: 12, color: theme.color.muted, marginTop: 4 } }));
const Price = styled.span({ fontWeight: 650, fontVariantNumeric: 'tabular-nums' });
const Buy = styled.button(({ theme }) => ({ minHeight: 44, padding: '10px 14px', border: 0, borderRadius: theme.radius.control, background: theme.color.primary, color: theme.color.surface, '&:disabled': { opacity: .5, cursor: 'default' } }));
const Receipt = styled.div(({ theme }) => ({ marginTop: 12, padding: 14, fontSize: 13, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.control, '& p': { marginTop: 6 }, '& a': { display: 'inline-flex', alignItems: 'center', minHeight: 44, marginRight: 12, color: theme.color.link, textDecoration: 'underline' } }));
