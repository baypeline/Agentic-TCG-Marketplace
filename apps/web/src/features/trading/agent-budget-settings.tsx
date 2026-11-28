'use client';
import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styled from '@emotion/styled';
import { agentBudgetStateSchema } from '@tcg/contracts';
import { useAgentBudget } from '../auth/agent-budget-client';
import { AgentWalletStatus } from '../auth/agent-wallet-status';
import { getWalletSession, walletQueryKey } from '../auth/wallet-client';
import { WalletLogin } from '../auth/wallet-login';
import { useAgentPanelStore } from '../../stores/agent-panel';
import { createTradingClient } from '../../lib/trading-client';
import { formatUsdc } from '../../lib/formatters';
import { parseUsdcInput, usdcDecimal } from './demo-model';
import { Button } from '../../components/ui';
import { Field, FormGrid, QuietButton, ErrorText } from './trading-ui';

type BudgetState = ReturnType<typeof agentBudgetStateSchema.parse>;
export function AgentBudgetSettings({ advanced }: { advanced: ReactNode }) {
  const session = useQuery({ queryKey: walletQueryKey, queryFn: getWalletSession, retry: false });
  const current = useAgentBudget();
  const [expanded, setExpanded] = useState(false), [notice, setNotice] = useState('');
  const query = useQueryClient();
  const openChat = useAgentPanelStore(state => state.setChatOpen);
  return <Root><Intro><h1>에이전트 설정</h1><p>구매에 사용할 예산을 정하고, 에이전트 지갑에 충전해 주세요.</p></Intro>
    {session.isPending ? <p role="status">로그인 상태를 확인하고 있어요.</p> : !session.data?.user ? <LoginCard><h2>지갑을 연결하면 시작할 수 있어요</h2><p>로그인하면 전용 에이전트 지갑이 자동으로 생성돼요. 예산은 내 계정에 저장됩니다.</p><WalletLogin /></LoginCard> : <>
      {notice && <p role="status">{notice}</p>}
      {current.isPending ? <p role="status">현재 구매 예산을 확인하고 있어요.</p> : current.isError ? <LoginCard><ErrorText role="alert">{current.error.message}</ErrorText><QuietButton onClick={() => void current.refetch()}>예산 다시 조회</QuietButton></LoginCard> : current.data && <>
        <BudgetOverview state={current.data} />
        <BudgetEditor key={`${current.data.policy.id}:${current.data.policy.version}`} state={current.data} owner={session.data.user} onSaved={async () => { setNotice('예산을 저장했어요. 다음 구매부터 적용됩니다.'); await query.invalidateQueries(); }} />
        <StartRow><Button onClick={() => openChat(true)}>에이전트에게 카드 구매 요청</Button><p>구매 버튼을 누르면 설정한 예산 안에서 결제를 진행해요.</p></StartRow>
      </>}
      <AgentWalletStatus compact />
      <Advanced onToggle={event => setExpanded(event.currentTarget.open)}><summary>상세 거래 조건과 실행 내역</summary><p>허용 카드, 할인 조건, 유효기간과 별도 정책을 관리할 수 있어요.</p>{expanded && advanced}</Advanced>
    </>}
  </Root>;
}
export function BudgetOverview({ state }: { state: BudgetState }) {
  const { budget, policy, currency } = state;
  return <Summary aria-label="현재 구매 예산"><SummaryHeading><h2>현재 적용 중인 예산</h2><span>{policy.enabled ? '구매 허용' : '구매 일시중지'}</span></SummaryHeading><Numbers><div><dt>남은 예산</dt><dd>{formatUsdc(budget.availableAmount, currency)}</dd></div><div><dt>건당 한도</dt><dd>{formatUsdc(policy.maxPerTrade, currency)}</dd></div><div><dt>총예산</dt><dd>{formatUsdc(policy.totalBudget, currency)}</dd></div></Numbers><Footnote>사용 완료 {formatUsdc(budget.spentAmount, currency)} · 결제 예약 {formatUsdc(budget.reservedAmount, currency)}. 지갑 잔액과 별도로 관리돼요.</Footnote></Summary>;
}
function BudgetEditor({ state, owner, onSaved }: { state: BudgetState; owner: { userId: string; agentId?: string }; onSaved(): Promise<void> }) {
  const [total, setTotal] = useState(usdcDecimal(state.policy.totalBudget, state.currency)), [per, setPer] = useState(usdcDecimal(state.policy.maxPerTrade, state.currency));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const client = useRef<ReturnType<typeof createTradingClient> | null>(null);
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    const totalBudget = parseUsdcInput(total, state.currency), maxPerTrade = parseUsdcInput(per, state.currency);
    if (!totalBudget || !maxPerTrade || BigInt(maxPerTrade) > BigInt(totalBudget) || BigInt(maxPerTrade) > BigInt(state.signerMaxPerTrade)) { setError(`건당 한도는 총예산 이하, 최대 ${formatUsdc(state.signerMaxPerTrade, state.currency)}로 설정해 주세요.`); return; }
    if (BigInt(totalBudget) < BigInt(state.budget.spentAmount) + BigInt(state.budget.reservedAmount)) { setError('총예산은 사용 완료액과 결제 예약액의 합계 이상이어야 해요.'); return; }
    setBusy(true);
    try {
      client.current ??= createTradingClient(sessionStorage, `${owner.userId}.${owner.agentId}`);
      if (client.current.pending()) throw new Error('저장 결과를 먼저 확인해 주세요.');
      const { id, version, agentId: _, ...fields } = state.policy;
      await client.current.mutate('PUT', `policies/${id}`, { ...fields, totalBudget, maxPerTrade, expectedVersion: version });
      await onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '예산을 저장하지 못했어요.'); }
    finally { setBusy(false); }
  }
  return <Editor onSubmit={save}><h2>예산 변경</h2><fieldset disabled={busy}><FormGrid><Field id="purchase-total" label={`총예산 (${state.currency})`}><input id="purchase-total" required inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></Field><Field id="purchase-per" label={`건당 한도 (${state.currency})`} hint={`결제 시스템의 건당 최대 금액은 ${formatUsdc(state.signerMaxPerTrade, state.currency)}예요.`}><input id="purchase-per" required inputMode="decimal" value={per} onChange={e => setPer(e.target.value)} /></Field></FormGrid>{error && <ErrorText role="alert">{error}</ErrorText>}<Button type="submit">{busy ? '저장 중…' : '예산 저장'}</Button></fieldset>{client.current?.pending() && <QuietButton type="button" disabled={busy} onClick={() => { setBusy(true); void client.current!.retry().then(onSaved).catch(() => setError('저장 결과를 확인하지 못했어요. 다시 확인해 주세요.')).finally(() => setBusy(false)); }}>이전 저장 결과 확인</QuietButton>}</Editor>;
}
const Root = styled.div({ maxWidth: 1000, '& p': { lineHeight: 1.8 }, '& button': { maxWidth: '100%' } });
const Intro = styled.div(({ theme }) => ({ marginBottom: 28, '& h1': { fontSize: 30, fontWeight: 600 }, '& p': { marginTop: 10, color: theme.color.muted, fontSize: 15 } }));
const LoginCard = styled.section(({ theme }) => ({ padding: '28px 0', '& h2': { fontSize: 20 }, '& p': { margin: '12px 0 20px', color: theme.color.muted } }));
const Summary = styled.section(({ theme }) => ({ padding: '24px 0', borderBlock: `1px solid ${theme.color.line}` }));
const SummaryHeading = styled.div(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center', justifyContent: 'space-between', '& h2': { fontSize: 19 }, '& span': { color: theme.color.muted, fontSize: 13 } }));
const Numbers = styled.dl({ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 20, marginTop: 24, '& dt': { fontSize: 13 }, '& dd': { margin: '8px 0 0', fontSize: 'clamp(18px,2vw,26px)', fontWeight: 600, overflowWrap: 'anywhere' }, '@media(max-width:479px)': { gridTemplateColumns: 'minmax(0,1fr)', gap: 16, '& > div': { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }, '& dd': { margin: 0, textAlign: 'right', fontSize: 20 } } });
const Footnote = styled.p(({ theme }) => ({ marginTop: 18, fontSize: 13, color: theme.color.muted }));
const Editor = styled.form({ padding: '24px 0', '& h2': { fontSize: 19, marginBottom: 20 }, '& fieldset': { border: 0, padding: 0, margin: 0, minWidth: 0 }, '& button': { marginTop: 20 }, '@media(max-width:639px)': { '& button[type=submit]': { width: '100%' } } });
const StartRow = styled.div(({ theme }) => ({ paddingBottom: 12, '& p': { fontSize: 13, color: theme.color.muted, marginTop: 12 } }));
const Advanced = styled.details(({ theme }) => ({ marginTop: 24, borderTop: `1px solid ${theme.color.line}`, '& > summary': { minHeight: 56, paddingBlock: 16, cursor: 'pointer', fontWeight: 600 }, '& > p': { color: theme.color.muted, fontSize: 14, marginBottom: 20 } }));
