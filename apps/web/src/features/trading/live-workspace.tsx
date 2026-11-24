'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { agentRunSchema, buyOrderSchema, cardVariantSchema, inventoryItemSchema, listingSchema, spendingPolicySchema, tradeSchema, type AgentRun, type BuyOrder, type CardVariant, type InventoryItem, type Listing, type SpendingPolicy, type Trade } from '@tcg/contracts';
import { Button } from '../../components/ui';
import { formatUsdc, getCardDisplayName } from '../../lib/formatters';
import { createTradingClient } from '../../lib/trading-client';
import { parseUsdcInput, usdcDecimal } from './demo-model';
import { LiveTradingStatus } from './live-status';
import { Actions, EmptyRows, ErrorText, Field, FormGrid, QuietButton, RecordTable, ResultNote, Section, StateBadge } from './trading-ui';

type Mode = 'agent' | 'marketplace' | 'collection' | 'activity';
type Identity = { userId: string; agentId?: string };
type Data = { me: Identity; policies: SpendingPolicy[]; runs: AgentRun[]; orders: BuyOrder[]; items: InventoryItem[]; listings: Listing[]; trades: Trade[]; cards: CardVariant[]; matches: { id: string; status: string }[] };
type Mutate = (method: string, path: string, input?: unknown) => Promise<void>;
const titles: Record<Mode, string> = { agent: '거래 정책과 실행 허용', marketplace: '고정가 매물', collection: '내 카드', activity: '거래 관리' };
async function read(path: string): Promise<unknown> {
  const response = await fetch(`/api/trading/${path}`, { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? '상태를 조회하지 못했습니다.');
  return data;
}
export function LiveTradingWorkspace({ mode, mine = false }: { mode: Mode; mine?: boolean }) {
  const [data, setData] = useState<Data | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const client = useRef<ReturnType<typeof createTradingClient> | null>(null);
  const inflight = useRef(false), mounted = useRef(true);
  const load = useCallback(async () => {
    const me = await read('me') as Identity;
    if (!client.current) client.current = createTradingClient(sessionStorage, `${me.userId}.${me.agentId ?? 'seller'}`);
    const [items, listings, policies, runs, orders, trades, matches] = await Promise.all([
      read('inventory'), read('listings'), me.agentId ? read('policies') : [], me.agentId ? read('sessions') : [], me.agentId ? read('buy-orders') : [], read('trades'), me.agentId ? read('matches') : [],
    ]);
    const inventory = inventoryItemSchema.array().parse(items), offers = listingSchema.array().parse(listings);
    const cardIds = [...new Set([...inventory, ...offers].map(item => item.cardVariantId))];
    const cards = await Promise.all(cardIds.map(async id => cardVariantSchema.parse(await read(`cards/${id}`))));
    if (mounted.current) setData({ me, items: inventory, listings: offers, policies: spendingPolicySchema.array().parse(policies), runs: agentRunSchema.array().parse(runs), orders: buyOrderSchema.array().parse(orders), trades: tradeSchema.array().parse(trades), cards, matches: matches as Data['matches'] });
  }, []);
  useEffect(() => {
    mounted.current = true;
    const refresh = () => { void load().catch(failure => { if (mounted.current) setError(failure.message); }); };
    refresh();
    window.addEventListener('tcg:purchase-completed', refresh);
    return () => { mounted.current = false; window.removeEventListener('tcg:purchase-completed', refresh); };
  }, [load]);
  async function run(work: () => Promise<unknown>, refreshed = false) {
    if (inflight.current) return;
    inflight.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const result = await work();
      setNotice(refreshed ? '서버 상태를 새로 조회했습니다.' : result === null ? '조건에 맞는 매물이 없습니다. 새 탐색은 새 요청으로 진행할 수 있어요.' : '서버에 반영했습니다. 최신 상태를 확인해 주세요.');
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : '서버 응답을 확인하지 못했습니다.'); }
    finally { inflight.current = false; if (mounted.current) setBusy(false); }
  }
  const mutate: Mutate = async (method, path, input) => { await run(() => client.current!.mutate(method, path, input)); };
  const unresolved = Boolean(client.current?.pending());
  const cardName = (id: string) => { const card = data?.cards.find(card => card.id === id); return card ? getCardDisplayName(card) : '카드 상세에서 확인'; };
  return <div>
    <Actions><h1>{titles[mode]}</h1><Link href={`/${mode}?preview=1`}>화면 미리보기</Link><QuietButton disabled={busy} onClick={() => void run(load, true)}>상태 새로고침</QuietButton></Actions>
    <ResultNote>이 화면은 서버에 저장됩니다. LLM 자동 구매와 지급 서명은 연결하지 않았으며, 예약만으로 결제되지 않습니다.</ResultNote>
    {error && <ErrorText role="alert">{error}</ErrorText>}{notice && <ResultNote role="status">{notice}</ResultNote>}
    {busy && <ResultNote role="status">서버 응답을 확인하고 있어요.</ResultNote>}
    {unresolved && <Section><h2>이전 요청 확인 필요</h2><ResultNote>응답을 받지 못한 요청이 있습니다. 새 작업 전에 같은 요청 키로 결과를 확인해 주세요. 새 결제나 서명을 만들지 않습니다.</ResultNote><QuietButton disabled={busy} onClick={() => void run(() => client.current!.retry())}>같은 요청 다시 확인</QuietButton></Section>}
    {!data && !error && <ResultNote role="status">거래 정보를 불러오고 있어요.</ResultNote>}
    {data && <fieldset disabled={busy || unresolved} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {mode === 'agent' && (data.me.agentId ? <PolicyAndRuns data={data} mutate={mutate} /> : <ResultNote>구매자 계정에서 거래 정책을 관리할 수 있어요.</ResultNote>)}
      {mode === 'collection' && <Section id="owned-cards"><h2>보유 카드</h2>{!data.items.length && <EmptyRows text="보유한 카드가 없어요." />}{data.items.map(item => <Section key={item.id}><h3><Link href={`/cards/${item.cardVariantId}`}>{cardName(item.cardVariantId)}</Link> · <StateBadge status={item.status} /></h3>{item.status === 'AVAILABLE' ? <AmountForm id={item.id} label="판매 가격 (USDC)" button="고정가 매물 등록" submit={amount => mutate('POST','listings',{ inventoryItemId: item.id, price: amount })} /> : <ResultNote>판매 중인 매물은 마켓에서 관리할 수 있어요. 예약 중이면 결과 확인을 기다려 주세요.</ResultNote>}</Section>)}</Section>}
      {mode === 'marketplace' && <Section><h2>{mine ? '내 판매 매물' : '판매 중인 매물'}</h2>{!data.listings.filter(row => !mine || row.sellerId === data.me.userId).length && <EmptyRows text="현재 판매 중인 매물이 없어요." />}{data.listings.filter(row => !mine || row.sellerId === data.me.userId).map(listing => <Section key={listing.id}><h3><Link href={`/cards/${listing.cardVariantId}`}>{cardName(listing.cardVariantId)}</Link> · {formatUsdc(listing.price)}</h3>{listing.sellerId === data.me.userId ? <QuietButton onClick={() => void mutate('DELETE',`listings/${listing.id}`)}>매물 등록 취소</QuietButton> : data.me.agentId ? <><AmountForm id={listing.id} label="최대 구매 가격 (USDC)" initial={usdcDecimal(listing.price)} button="이 매물 예약" submit={maxPrice => mutate('POST','purchases/fixed/quote',{ listingId: listing.id, maxPrice })} /><AmountForm id={`order-${listing.id}`} label="지정가 주문 상한 (USDC)" button="지정가 주문 등록" expires submit={(maxPrice, expiresAt) => mutate('POST','buy-orders',{ cardVariantId: listing.cardVariantId, maxPrice, expiresAt })} /></> : <ResultNote>구매자 계정에서 주문·예약할 수 있어요.</ResultNote>}</Section>)}{data.me.agentId && <MarketQuote key={data.cards.map(card => card.id).join(',')} cards={data.cards} mutate={mutate} />}</Section>}
      {mode === 'activity' && <>
        {data.me.agentId && <Section><h2>구매 주문</h2>{!data.orders.length && <EmptyRows text="등록한 구매 주문이 없어요." />}{data.orders.map(order => <Section key={order.id}><h3><Link href={`/cards/${order.cardVariantId}`}>{cardName(order.cardVariantId)}</Link> · {formatUsdc(order.maxPrice)} · <StateBadge status={order.status} /></h3><Actions>{order.status === 'ACTIVE' && <><QuietButton onClick={() => void mutate('POST',`buy-orders/${order.id}/match`)}>새 매칭 탐색</QuietButton><QuietButton onClick={() => void mutate('POST',`buy-orders/${order.id}/pause`)}>주문 일시중지</QuietButton></>}{order.status === 'MATCH_PENDING' && <QuietButton onClick={() => void mutate('POST',`buy-orders/${order.id}/pause`)}>결제 보류</QuietButton>}{order.status === 'PAUSED' && <QuietButton onClick={() => void mutate('POST',`buy-orders/${order.id}/resume`)}>주문 재개</QuietButton>}{['ACTIVE','PAUSED','MATCH_PENDING'].includes(order.status) && <QuietButton onClick={() => void mutate('POST',`buy-orders/${order.id}/cancel`)}>주문 취소</QuietButton>}</Actions></Section>)}</Section>}
        <Section><h2>미제출 카드 예약</h2>{data.matches.filter(match => match.status === 'RESERVED').map(match => <Actions key={match.id}><span>예약 #{match.id.slice(-6)}</span><QuietButton onClick={() => void mutate('DELETE',`quotes/${match.id}`)}>예약 취소</QuietButton></Actions>)}<ResultNote>제출된 결제와 확인 중인 결제는 서버가 복구하며 이 화면에서 재결제하지 않습니다.</ResultNote></Section>
        <RecordTable label="완료 거래" headings={['거래','구분','금액','완료 시각']}>{data.trades.map(trade => <tr key={trade.id}><td data-label="거래">#{trade.id.slice(-6)}</td><td data-label="구분">{trade.buyerId === data.me.userId ? '구매' : '판매'}</td><td data-label="금액">{formatUsdc(trade.price)}</td><td data-label="완료 시각">{new Date(trade.completedAt).toLocaleString('ko-KR')}</td></tr>)}</RecordTable>
      </>}
    </fieldset>}
    {(mode === 'agent' || mode === 'activity') && <LiveTradingStatus key={`${notice}-${data?.runs.length}`} />}
  </div>;
}
function AmountForm({ id, label, button, initial = '', expires = false, submit }: { id: string; label: string; button: string; initial?: string; expires?: boolean; submit(amount: string, expiresAt?: string): Promise<void> }) {
  const [value, setValue] = useState(initial), [until, setUntil] = useState(''), [error, setError] = useState('');
  function save(event: FormEvent) {
    event.preventDefault(); const amount = parseUsdcInput(value);
    if (!amount) { setError('0보다 큰 금액을 소수점 6자리 이내로 입력해 주세요.'); return; }
    if (expires && !/^\d{4}-\d{2}-\d{2}$/.test(until)) { setError('주문 유효 날짜를 선택해 주세요.'); return; }
    setError(''); void submit(amount, expires ? `${until}T23:59:59.000Z` : undefined);
  }
  return <form onSubmit={save}><FormGrid><Field id={`amount-${id}`} label={label} error={error}><input id={`amount-${id}`} required inputMode="decimal" value={value} onChange={e => setValue(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `amount-${id}-error` : undefined} /></Field>{expires && <Field id={`until-${id}`} label="주문 유효 날짜 (UTC 마지막 시각)"><input id={`until-${id}`} type="date" required value={until} onChange={e => setUntil(e.target.value)} /></Field>}</FormGrid><Button type="submit">{button}</Button></form>;
}
function MarketQuote({ cards, mutate }: { cards: CardVariant[]; mutate: Mutate }) {
  const [id, setId] = useState(cards[0]?.id ?? '');
  return <Section><h2>시장가 예약</h2><Field id="market-card" label="카드"><select id="market-card" value={id} onChange={e => setId(e.target.value)}>{cards.map(card => <option key={card.id} value={card.id}>{getCardDisplayName(card)}</option>)}</select></Field>{id && <AmountForm id="market" label="최대 구매 가격 (USDC)" button="최적 매물 탐색·예약" submit={maxPrice => mutate('POST','purchases/market/quote',{ cardVariantId: id, maxPrice })} />}</Section>;
}
function PolicyAndRuns({ data, mutate }: { data: Data; mutate: Mutate }) {
  const [selected, setSelected] = useState('');
  const policy = data.policies.find(policy => policy.id === selected);
  return <>
    <Section><h2>구매 승인 정책</h2><Field id="select-policy" label="편집할 정책"><select id="select-policy" value={selected} onChange={e => setSelected(e.target.value)}><option value="">새 정책 만들기</option>{data.policies.map(policy => <option key={policy.id} value={policy.id}>정책 #{policy.id.slice(-6)} · v{policy.version}</option>)}</select></Field><PolicyEditor key={`${policy?.id}:${policy?.version}`} policy={policy} cards={data.cards} mutate={mutate} /></Section>
    <Section><h2>수동 거래 허용</h2><ResultNote>선택한 정책으로 주문 재개·카드 예약을 허용합니다. LLM은 실행하지 않으며 자동 구매·서명·지급은 발생하지 않습니다. 중단해도 기존 미제출 예약은 원래 만료 시간까지 유지됩니다.</ResultNote>{data.policies.filter(policy => policy.enabled).map(policy => <QuietButton key={policy.id} disabled={data.runs.some(run => run.status === 'RUNNING')} onClick={() => void mutate('POST','sessions',{ policyId: policy.id, instruction: '사용자 수동 거래 검증' })}>정책 #{policy.id.slice(-6)}로 거래 허용</QuietButton>)}{data.runs.filter(run => run.status === 'RUNNING').map(run => <Actions key={run.id}><span>서버 실행 #{run.id.slice(-6)}</span><QuietButton onClick={() => void mutate('POST',`sessions/${run.id}/stop`)}>거래 실행 중단</QuietButton></Actions>)}</Section>
  </>;
}
function PolicyEditor({ policy, cards, mutate }: { policy?: SpendingPolicy; cards: CardVariant[]; mutate: Mutate }) {
  const [total, setTotal] = useState(policy ? usdcDecimal(policy.totalBudget) : ''), [per, setPer] = useState(policy ? usdcDecimal(policy.maxPerTrade) : ''), [discount, setDiscount] = useState(policy?.minDiscountPercent === undefined ? '' : String(policy.minDiscountPercent)), [until, setUntil] = useState(policy?.validUntil.slice(0,10) ?? ''), [enabled, setEnabled] = useState(policy?.enabled ?? false), [allowed, setAllowed] = useState(policy?.allowedCardVariantIds ?? []), [error, setError] = useState('');
  function save(event: FormEvent) {
    event.preventDefault(); const totalBudget = parseUsdcInput(total), maxPerTrade = parseUsdcInput(per);
    if (!totalBudget || !maxPerTrade || BigInt(maxPerTrade) > BigInt(totalBudget)) { setError('총예산과 건당 한도를 확인해 주세요. 금액은 소수점 6자리까지 입력하고 건당 한도는 총예산 이하여야 합니다.'); return; }
    if (discount !== '' && (!Number.isFinite(Number(discount)) || Number(discount) < 0 || Number(discount) > 100)) { setError('할인율은 0~100 사이로 입력해 주세요.'); return; }
    setError(''); const input = { enabled, totalBudget, maxPerTrade, validUntil: policy && policy.validUntil.slice(0,10) === until ? policy.validUntil : `${until}T23:59:59.000Z`, ...(discount === '' ? {} : { minDiscountPercent: Number(discount) }), ...(allowed.length ? { allowedCardVariantIds: allowed } : {}) };
    void mutate(policy ? 'PUT' : 'POST', policy ? `policies/${policy.id}` : 'policies', { ...input, ...(policy ? { expectedVersion: policy.version } : {}) });
  }
  return <form onSubmit={save}><FormGrid><Field id="live-budget" label="총예산 (USDC)"><input id="live-budget" required inputMode="decimal" value={total} onChange={e => setTotal(e.target.value)} /></Field><Field id="live-per" label="건당 한도 (USDC)"><input id="live-per" required inputMode="decimal" value={per} onChange={e => setPer(e.target.value)} /></Field><Field id="live-discount" label="최소 할인율 (%)" hint="비워두면 가격 상한만 검사합니다. 입력하면 유효한 실제 적정가가 필요합니다."><input id="live-discount" inputMode="decimal" value={discount} onChange={e => setDiscount(e.target.value)} /></Field><Field id="live-until" label="정책 유효 날짜 (UTC)"><input id="live-until" required type="date" value={until} onChange={e => setUntil(e.target.value)} /></Field></FormGrid>
    <Section><h3>허용 카드</h3><ResultNote>선택하지 않으면 카드 제한을 두지 않습니다. 기존에 허용한 카드는 현재 매물에 없어도 유지됩니다.</ResultNote>{cards.map(card => <label key={card.id} style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={allowed.includes(card.id)} onChange={e => setAllowed(e.target.checked ? [...allowed,card.id] : allowed.filter(id => id !== card.id))} /> {getCardDisplayName(card)}</label>)}<label style={{ display: 'block', minHeight: 44 }}><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> 이 정책으로 거래 허용</label></Section>{error && <ErrorText role="alert">{error}</ErrorText>}<Button type="submit">{policy ? '정책 수정 저장' : '새 정책 저장'}</Button>
  </form>;
}
