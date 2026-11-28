'use client';

import { useEffect, useRef, useState } from 'react';
import type { Currency, AgentRun, PurchaseStatus, SpendingPolicy } from '@tcg/contracts';
import { formatUsdc } from '../../lib/formatters';
import { describePurchase } from '../../lib/purchase-status';
import { Actions, ErrorText, Metrics, QuietButton, ResultNote, Section } from './trading-ui';

type Snapshot = { currency?: Currency; budgets: { policy: SpendingPolicy; budget: { spentAmount: string; reservedAmount: string; availableAmount: string } }[]; runs: AgentRun[]; purchases: PurchaseStatus[]; proceeds: { amount: string; tradeCount: number } };
export function LiveTradingStatus() {
  const [data, setData] = useState<Snapshot | null>(null), [error, setError] = useState(''), [clock, setClock] = useState(0), [refresh, setRefresh] = useState(0);
  const receivedAt = useRef(0);
  useEffect(() => {
    let active = true, pending = false;
    const abort = new AbortController();
    async function load() {
      if (pending) return;
      pending = true;
      try {
        const response = await fetch('/api/trading-status', { cache: 'no-store', signal: abort.signal });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error ?? '상태 조회 실패');
        if (active) { receivedAt.current = performance.now(); setClock(0); setData(body); setError(''); }
      } catch (failure) { if (active && !abort.signal.aborted) setError(failure instanceof Error ? failure.message : '상태 조회 실패'); }
      finally { pending = false; }
    }
    void load();
    const timer = setInterval(() => void load(), 5000);
    const tick = setInterval(() => setClock(Math.max(0, performance.now() - receivedAt.current)), 1000);
    return () => { active = false; clearInterval(timer); clearInterval(tick); abort.abort(); };
  }, [refresh]);
  return <Section aria-labelledby="live-status-heading"><Actions><h2 id="live-status-heading">서버 실행·거래 상태</h2><QuietButton type="button" onClick={() => setRefresh(value => value+1)}>상태 새로고침</QuietButton></Actions>
    <ResultNote>서버가 실행과 복구를 관리합니다. 이 창을 닫아도 실행은 중단되지 않습니다. 아래 조회는 주문·서명·결제를 다시 실행하지 않습니다.</ResultNote>
    {error && <ErrorText role="alert">{error}{data ? ' 이전 조회 결과가 남아 있습니다.' : ''}</ErrorText>}
    {!data && !error && <ResultNote role="status">서버 상태를 확인하고 있습니다.</ResultNote>}
    {data?.budgets.map(({ policy, budget }) => <div key={policy.id}><h3>정책 v{policy.version}</h3><Metrics items={[{ label: '사용 완료', value: formatUsdc(budget.spentAmount, data.currency) }, { label: '결제 예약', value: formatUsdc(budget.reservedAmount, data.currency) }, { label: '사용 가능', value: formatUsdc(budget.availableAmount, data.currency) }]} /></div>)}
    <div aria-live="polite">{data?.runs.map(run => <ResultNote key={run.id}>실행 #{run.id.slice(-6)} · {run.status === 'RUNNING' ? '서버 실행 중' : run.status === 'STOPPED' ? '중단됨' : run.status === 'COMPLETED' ? '완료' : '오류'}{run.result ? ` · ${run.result}` : ''}</ResultNote>)}</div>
    {data?.purchases.map(purchase => { const view = describePurchase(purchase, clock); return <Section key={purchase.id}><h3>{view.title} · {formatUsdc(purchase.amount, data.currency)}</h3><ResultNote>{view.detail}</ResultNote>{purchase.holdReasons.length > 0 && <ResultNote role="status">최신 정책 또는 실행 상태를 확인해 주세요. 기존 예약은 자동 취소하지 않습니다.</ResultNote>}</Section>; })}
    {data && <ResultNote>모의 판매 수익 · 출금 불가: {formatUsdc(data.proceeds.amount, data.currency)} / 완료 거래 {data.proceeds.tradeCount}건</ResultNote>}
  </Section>;
}
