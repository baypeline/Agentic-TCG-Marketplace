'use client';

import styled from '@emotion/styled';
import type { AgentBudgetProposal, AgentBudgetResult } from '@tcg/contracts';
import { formatUsdc } from '../../lib/formatters';

export function BudgetProposal({ proposal, result, disabled, onAction }: { proposal: AgentBudgetProposal; result?: AgentBudgetResult; disabled: boolean; onAction(action: 'confirm' | 'cancel'): void }) {
  const money = (value: string) => formatUsdc(value, proposal.currency);
  return <Root aria-label="예산 변경 확인">
    <h4>예산 변경안</h4>
    <Rows><div><dt>총예산</dt><dd>{money(proposal.previousTotalBudget)} → <strong>{money(proposal.totalBudget)}</strong></dd></div><div><dt>건당 한도</dt><dd>{money(proposal.previousMaxPerTrade)} → <strong>{money(proposal.maxPerTrade)}</strong></dd></div><div><dt>사용 완료 · 결제 예약</dt><dd>{money(proposal.spentAmount)} · {money(proposal.reservedAmount)}</dd></div><div><dt>변경 후 사용 가능</dt><dd>{money(proposal.availableAmount)}</dd></div></Rows>
    <Note>서버 서명기의 건당 상한은 {money(proposal.signerMaxPerTrade)}입니다. 확인할 때 최신 지출과 예약 금액을 다시 검사해요.</Note>
    {result ? <p role="status">{result.status === 'APPLIED' ? '예산 설정을 저장했어요.' : '변경을 취소했어요.'}{result.budget && <> 현재 사용 가능 {money(result.budget.availableAmount)}</>}</p> : <><Note>5분 안에 확인해 주세요. 새 메시지를 보내면 이 변경안은 사용할 수 없어요.</Note><Actions><Confirm type="button" disabled={disabled} onClick={() => onAction('confirm')}>확인하고 저장</Confirm><Cancel type="button" disabled={disabled} onClick={() => onAction('cancel')}>취소</Cancel></Actions></>}
  </Root>;
}

const Root = styled.section(({ theme }) => ({ marginTop: 16, paddingTop: 16, borderTop: `1px solid ${theme.color.line}`, '& h4': { fontSize: 14, margin: '0 0 12px' }, '& > p': { fontSize: 13 } }));
const Rows = styled.dl({ margin: 0, display: 'grid', gap: 10, '& div': { display: 'grid', gap: 2 }, '& dt': { fontSize: 12 }, '& dd': { margin: 0, fontSize: 13, overflowWrap: 'anywhere' } });
const Note = styled.p(({ theme }) => ({ fontSize: 12, color: theme.color.muted, marginTop: 12, lineHeight: 1.7 }));
const Actions = styled.div({ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 });
const Confirm = styled.button(({ theme }) => ({ minHeight: 44, padding: '8px 14px', background: theme.color.primary, color: theme.color.surface, border: 0, borderRadius: 6, fontSize: 13, '&:disabled': { opacity: .4 }, '&:hover:not(:disabled)': { background: theme.color.primaryHover } }));
const Cancel = styled.button(({ theme }) => ({ minHeight: 44, padding: '8px 14px', background: theme.color.surface, color: theme.color.ink, border: `1px solid ${theme.color.line}`, borderRadius: 6, fontSize: 13, '&:disabled': { opacity: .4 } }));
