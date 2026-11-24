'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { formatUsdc, formatUtc } from '../../lib/formatters';
import { useDemoTrading } from './demo-provider';
import { SellerProceedsNote } from './seller-guide';
import { Actions, CardCell, EmptyRows, Filters, Metrics, PreviewPage, QuietButton, RecordTable, ResultNote, Section, StateBadge, Tabs } from './trading-ui';

export type ActivityTab = 'orders' | 'payments' | 'trades';
const names: Record<ActivityTab, string> = { orders: '구매 주문', payments: '결제', trades: '거래 내역' };
const options: Record<ActivityTab, [string, string][]> = {
  orders: [['ACTIVE', '활성'], ['PAUSED', '일시중지'], ['MATCH_PENDING', '매칭 대기'], ['FILLED', '체결 완료'], ['CANCELLED', '취소'], ['EXPIRED', '만료']],
  payments: [['PENDING', '진행 중'], ['SETTLED', '결제 확인'], ['FAILED', '실패'], ['UNKNOWN', '확인 필요']],
  trades: [['BUY', '구매'], ['SELL', '판매']],
};

export function ActivityView({ view }: { view: ActivityTab }) {
  const { state, dispatch } = useDemoTrading();
  const [filters, setFilters] = useState<Record<ActivityTab, string>>({ orders: 'ALL', payments: 'ALL', trades: 'ALL' });
  const [selected, setSelected] = useState('');
  const [notice, setNotice] = useState('');
  useEffect(() => { setSelected(''); setNotice(''); }, [view]);
  const filter = filters[view];
  const orders = state.orders.filter(row => filter === 'ALL' || row.status === filter);
  const payments = state.payments.filter(row => filter === 'ALL' || row.status === filter);
  const trades = state.trades.filter(row => filter === 'ALL' || row.direction === filter);
  const payment = view === 'payments' ? state.payments.find(row => row.id === selected) : undefined;
  const order = view === 'orders' ? state.orders.find(row => row.id === selected) : undefined;
  const trade = view === 'trades' ? state.trades.find(row => row.id === selected) : undefined;
  function details(id: string) { setSelected(current => current === id ? '' : id); }
  return <PreviewPage title="거래 관리" description="Agent의 구매 주문과 결제, 직접 등록한 카드의 판매 결과를 확인해요. 모든 기록은 데모예요." actions={<Link href="/agent/logs">Agent 로그 보기</Link>}>
    <ResultNote>모의 판매 수익 · 출금 불가: {formatUsdc(state.trades.filter(row => row.direction === 'SELL').reduce((sum, row) => sum + BigInt(row.price), 0n).toString())}. 완료된 거래만 집계합니다.</ResultNote>
    <Metrics items={[{ label: '활성 구매 주문', value: `${state.orders.filter(row => row.status === 'ACTIVE').length}건` }, { label: '확인이 필요한 결제', value: `${state.payments.filter(row => row.status === 'FAILED' || row.status === 'UNKNOWN').length}건` }, { label: '완료된 거래', value: `${state.trades.length}건` }]} />
    <Tabs aria-label="거래 관리 메뉴">{Object.entries(names).map(([key, name]) => <Link key={key} href={`/activity?view=${key}`} aria-current={view === key ? 'page' : undefined}>{name}</Link>)}</Tabs>
    {view !== 'orders' && <SellerProceedsNote />}
    <Filters><label>{view === 'trades' ? '거래 구분' : '상태'}<select value={filter} onChange={e => setFilters(current => ({ ...current, [view]: e.target.value }))}><option value="ALL">전체</option>{options[view].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></Filters>
    {view === 'orders' && <><RecordTable label={`예시 구매 주문 ${orders.length}건`} headings={['카드', '최대 구매가', '상태', '관리']}>
      {orders.map(row => <tr key={row.id}><td data-label="카드"><CardCell id={row.cardVariantId} /></td><td data-label="최대 구매가">{formatUsdc(row.maxPrice)}</td><td data-label="상태"><StateBadge status={row.status} /></td><td data-label="관리"><Actions><QuietButton type="button" aria-expanded={selected === row.id} aria-controls="activity-detail" onClick={() => details(row.id)}>상세</QuietButton>{(row.status === 'ACTIVE' || row.status === 'PAUSED') && <><QuietButton type="button" onClick={() => { dispatch({ type: 'ORDER', id: row.id, status: row.status === 'ACTIVE' ? 'PAUSED' : 'ACTIVE' }); setNotice('주문 상태를 미리보기에 반영했어요. 실제 Agent에는 전송하지 않았어요.'); }}>{row.status === 'ACTIVE' ? '일시중지' : '재개'}</QuietButton><QuietButton type="button" onClick={() => { dispatch({ type: 'ORDER', id: row.id, status: 'CANCELLED' }); setNotice('취소 상태를 미리보기에 반영했어요.'); }}>취소</QuietButton></>}</Actions></td></tr>)}
    </RecordTable>{!orders.length && <EmptyRows />}</>}
    {view === 'payments' && <><RecordTable label={`예시 결제 ${payments.length}건`} headings={['카드', '구분', '금액', '상태', '확인']}>
      {payments.map(row => <tr key={row.id}><td data-label="카드"><CardCell id={row.cardVariantId} /></td><td data-label="구분">{row.direction === 'OUT' ? '구매 결제' : '판매 수익 기록 (모의)'}</td><td data-label="금액">{formatUsdc(row.amount)}</td><td data-label="상태">{row.direction === 'IN' ? '모의 장부 기록' : <StateBadge status={row.status} />}</td><td data-label="확인"><QuietButton type="button" aria-expanded={selected === row.id} aria-controls="activity-detail" onClick={() => details(row.id)}>{row.direction === 'IN' ? '수익 기록 상세' : '결제 상세'}</QuietButton></td></tr>)}
    </RecordTable>{!payments.length && <EmptyRows />}</>}
    {view === 'trades' && <><RecordTable label={`예시 거래 내역 ${trades.length}건`} headings={['카드', '구분', '거래 금액', '완료 시각 (UTC)', '확인']}>
      {trades.map(row => <tr key={row.id}><td data-label="카드"><CardCell id={row.cardVariantId} /></td><td data-label="구분">{row.direction === 'BUY' ? '구매' : '판매'}</td><td data-label="거래 금액">{formatUsdc(row.price)}</td><td data-label="완료 시각"><time dateTime={row.completedAt}>{formatUtc(row.completedAt)}</time></td><td data-label="확인"><QuietButton type="button" aria-expanded={selected === row.id} aria-controls="activity-detail" onClick={() => details(row.id)}>거래 상세</QuietButton></td></tr>)}
    </RecordTable>{!trades.length && <EmptyRows />}</>}
    {(order || payment || trade) && <Section id="activity-detail"><h2>{names[view]} 상세</h2>
      {order && <><p>주문 #{order.id.slice(-4)} / <StateBadge status={order.status} /></p><ResultNote>주문 상한 {formatUsdc(order.maxPrice)} / 유효 시각 {formatUtc(order.expiresAt)} UTC</ResultNote>{order.status === 'MATCH_PENDING' && <ResultNote>매칭 대기 상태에서는 결제와 예약 상태를 함께 확인해야 해요. 미리보기에서는 취소·재개를 제공하지 않아요.</ResultNote>}<Link href="/activity?view=payments">결제 목록 보기</Link></>}
      {payment && <><p>{payment.direction === 'IN' ? '판매 수익 기록' : '결제'} #{payment.id.slice(-4)} / {payment.direction === 'IN' ? '모의 장부 기록' : <StateBadge status={payment.status} />}</p><ResultNote>금액 {formatUsdc(payment.amount)} / 갱신 시각 {formatUtc(payment.updatedAt)} UTC</ResultNote>
        {payment.direction === 'IN' ? <ResultNote>판매 결과를 보여주는 내부 장부 예시예요. 온체인 입금이나 출금 가능한 잔액이 아니며 지급 트랜잭션은 없어요.</ResultNote> : <>
          {payment.status === 'UNKNOWN' && <ResultNote>결제 결과를 아직 확인하지 못한 상태예요. 중복 결제를 막기 위해 재시도하지 않고 상태 확인을 기다리는 화면입니다.</ResultNote>}
          {payment.status === 'PENDING' && <ResultNote>결제 결과를 기다리는 상태예요. 실제 네트워크 요청이나 자동 갱신은 없어요.</ResultNote>}
          {payment.status === 'FAILED' && <ResultNote>확정 실패한 결제입니다. 같은 결제를 다시 실행하지 않고 새 구매에는 새 예약을 사용합니다.</ResultNote>}
          <ResultNote>블록체인 거래 해시: 미연결</ResultNote></>}
        <Link href="/agent/logs">관련 상태를 로그에서 확인</Link></>}
      {trade && <><p>거래 #{trade.id.slice(-4)} / 완료</p><ResultNote>보유 번호 #{trade.inventoryItemId.slice(-4)} / 결제 번호 #{trade.paymentAttemptId.slice(-4)}</ResultNote><Actions><Link href="/collection">내 카드 보기</Link><Link href="/activity?view=payments">결제 내역 보기</Link></Actions></>}
      <details><summary>기록 번호 확인</summary><p>{selected}</p></details>
    </Section>}
    <ResultNote role="status">{notice}</ResultNote>
  </PreviewPage>;
}
