'use client';

import { lazy, Suspense, useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import styled from '@emotion/styled';
import { keyframes } from '@emotion/react';
import { readAgentMessage } from './agent-client';
import { CardChoices, cardChoiceLabel, cardChoiceQuestion } from './card-choices';
import { PurchaseOffers, PurchaseReceipt } from './purchase-offers';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { agentPurchaseProgressSchema, demoStatusSchema, type AgentPurchaseOffer, type AgentPurchaseProgress, type CardVariant } from '@tcg/contracts';
import { formatUsdc, getCardDisplayName } from '../../lib/formatters';

const AgentMarkdown = lazy(() => import('./agent-markdown'));
const CardOpening = lazy(() => import('./card-opening/card-opening'));

const suggestions = ['피카츄 찾아줘', '리자몽 적정가 알려줘', '이브이 시세가 어느 정도야?'];

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  cardChoices?: CardVariant[];
  purchaseOffers?: AgentPurchaseOffer[];
  selectedCardId?: string;
  interrupted?: boolean;
}

export function AgentChat({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [streamingText, setStreamingText] = useState('');
  const [purchaseStatus, setPurchaseStatus] = useState('');
  const [receipts, setReceipts] = useState<AgentPurchaseProgress[]>([]);
  const [openedCard, setOpenedCard] = useState<CardVariant | null>(null);
  const announcedPurchases = useRef(new Set<string>());
  const queryClient = useQueryClient();
  const router = useRouter();
  const demo = useQuery({ queryKey: ['demo-status'], queryFn: async () => { const result = await fetch('/api/demo'); if (!result.ok) throw new Error('Unavailable'); return demoStatusSchema.parse(await result.json()); }, staleTime: Infinity, retry: false });
  const examples = demo.data?.enabled ? demo.data.suggestions : suggestions;
  const sessionId = useRef<string | undefined>(undefined);
  const activeRequest = useRef<AbortController | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const followOutput = useRef(true);
  const purchaseRequests = useRef(new Map<string, { id: string; sessionId: string; submitted: boolean; prepared?: AgentPurchaseProgress }>());
  const latestChoices = messages.reduce((last, message, index) => message.cardChoices?.length ? index : last, -1);
  const latestOffers = messages.length - 1;
  useEffect(() => { if (history.current && followOutput.current) history.current.scrollTop = history.current.scrollHeight; }, [messages, streamingText, receipts, purchaseStatus]);

  useEffect(() => () => { activeRequest.current?.abort(); }, []);

  async function sendMessage(message: string, displayedMessage = message, preserveDraft = false): Promise<boolean> {
    if (!message || message.length > 2000 || activeRequest.current) return false;

    const request = new AbortController();
    let partial = '';
    activeRequest.current = request;
    followOutput.current = true;
    setMessages(current => [...current, { role: 'user', content: displayedMessage }]);
    if (!preserveDraft) setDraft('');
    setError('');
    setPending(true);
    setStreamingText('');
    input.current?.focus();

    try {
      const response = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message, sessionId: sessionId.current }),
        signal: request.signal,
      });
      if (!response.ok || !response.body) {
        const failure = await response.json().catch(() => null);
        throw new Error(failure?.message || '에이전트에 연결하지 못했습니다.');
      }
      if (activeRequest.current !== request) return false;
      const id = response.headers.get('x-agent-session-id');
      if (!id) throw new Error('대화 세션을 확인하지 못했습니다.');
      sessionId.current = id;
      const reply = await readAgentMessage(response.body, { onTextDelta: delta => {
        if (activeRequest.current !== request) return;
        partial += delta;
        setStreamingText(partial);
      } });
      if (activeRequest.current === request) {
        setMessages(current => [...current, { role: 'assistant', ...reply }]);
        return true;
      }
      return false;
    } catch (failure) {
      if (activeRequest.current === request && !request.signal.aborted) {
        setError(failure instanceof Error ? failure.message : '에이전트 답변을 받지 못했습니다.');
        setMessages(current => partial ? [...current, { role: 'assistant', content: partial, interrupted: true }] : current.slice(0, -1));
        if (!preserveDraft) setDraft(current => current || message);
      }
      return false;
    } finally {
      if (activeRequest.current === request && !request.signal.aborted) {
        activeRequest.current = null;
        setPending(false);
        setStreamingText('');
      }
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendMessage(draft.trim());
  }

  async function selectCard(card: CardVariant, messageIndex: number) {
    if (activeRequest.current) return;
    const selectedSession = sessionId.current;
    setMessages(current => current.map((message, index) => index === messageIndex ? { ...message, selectedCardId: card.id } : message));
    const succeeded = await sendMessage(cardChoiceQuestion(card), `${cardChoiceLabel(card)} 카드의 적정가를 알려줘.`, true);
    // 실패했으면 같은 후보를 다시 선택할 수 있도록 한다.
    if (!succeeded && sessionId.current === selectedSession) setMessages(current => current.map((message, index) => index === messageIndex ? { ...message, selectedCardId: undefined } : message));
  }

  async function buyOffer(offer: AgentPurchaseOffer) {
    if (activeRequest.current || !sessionId.current) return;
    const request = new AbortController();
    activeRequest.current = request;
    const state = purchaseRequests.current.get(offer.listingId) ?? { id: crypto.randomUUID(), sessionId: sessionId.current, submitted: false };
    purchaseRequests.current.set(offer.listingId, state);
    setPending(true); setError(''); followOutput.current = true;
    const api = async (action: 'prepare' | 'submit' | 'status' | 'cancel', paymentPayload?: unknown, signal = request.signal) => {
      const response = await fetch('/api/agent/chat/purchases', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId: state.sessionId, requestId: state.id, listingId: offer.listingId, action, ...(paymentPayload ? { paymentPayload } : {}) }), signal });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.message ?? '거래 요청을 완료하지 못했어요.');
      return agentPurchaseProgressSchema.parse(payload);
    };
    try {
      let progress: AgentPurchaseProgress;
      if (state.submitted) { setPurchaseStatus('기존 결제 상태를 확인하고 있어요.'); progress = await api('status'); }
      else {
        setPurchaseStatus('매물을 예약하고 결제 금액을 확인하고 있어요.');
        progress = await api('prepare');
        state.prepared = progress;
        if (progress.status === 'PAYMENT_REQUIRED') {
          let payload: unknown;
          if (progress.signingMode === 'server') {
            setPurchaseStatus(`에이전트 지갑에서 ${formatUsdc(progress.amount, progress.currency)} 지급을 승인하고 있어요.`);
          } else {
            setPurchaseStatus(`${formatUsdc(progress.amount, progress.currency)} 지급 승인을 지갑에서 확인해 주세요. Base Sepolia 테스트 USDC가 실제 전송됩니다.`);
            const { connectPaymentWallet } = await import('./wallet-payment');
            const wallet = await connectPaymentWallet();
            payload = await wallet.sign(progress, offer);
          }
          if (activeRequest.current !== request) return;
          state.submitted = true;
          setPurchaseStatus('서명한 지급을 제출하고 정산을 확인하고 있어요.');
          progress = await api('submit', payload);
        } else { state.submitted = progress.status === 'PENDING' || progress.status === 'COMPLETED'; }
      }
      if (progress.status === 'PAYMENT_REQUIRED' && state.submitted) {
        state.submitted = false;
        throw new Error('지급이 제출되지 않았어요. 에이전트 지갑 잔액과 정책을 확인한 뒤 다시 구매해 주세요.');
      }
      for (let attempt = 0; progress.status === 'PENDING' && attempt < 8; attempt++) {
        if (activeRequest.current !== request) return;
        setPurchaseStatus('새 지급 없이 기존 결제·체결을 확인하고 있어요.');
        await new Promise<void>(resolve => { const timer = setTimeout(done, 2000); function done() { clearTimeout(timer); request.signal.removeEventListener('abort', done); resolve(); } request.signal.addEventListener('abort', done, { once: true }); });
        request.signal.throwIfAborted();
        progress = await api('status');
      }
      if (activeRequest.current !== request) return;
      setReceipts(current => [...current.filter(item => item.requestId !== progress.requestId), progress]);
      if (progress.status === 'CANCELLED' || progress.status === 'FAILED') purchaseRequests.current.delete(offer.listingId);
      if (progress.status === 'COMPLETED' && !announcedPurchases.current.has(progress.requestId)) {
        announcedPurchases.current.add(progress.requestId);
        setOpenedCard(progress.card);
        setMessages(current => [...current, { role: 'assistant', content: `${getCardDisplayName(offer.card)} 카드를 ${formatUsdc(progress.amount, progress.currency)}에 구매했어요. ${progress.currency === 'tOKRW' ? 'tOKRW' : '테스트 USDC'} 결제가 확인되어 내 카드와 거래 내역에 반영됐어요.` }]);
        void queryClient.invalidateQueries(); window.dispatchEvent(new Event('tcg:purchase-completed')); router.refresh();
      }
    } catch (failure) {
      if (activeRequest.current === request && !request.signal.aborted) {
        const { walletErrorMessage } = await import('./wallet-payment');
        setError(state.submitted ? `${state.prepared?.signingMode === 'server' && failure instanceof Error ? `${failure.message} ` : '결제 응답을 확인하지 못했어요. '}같은 매물의 버튼을 누르면 새 서명 없이 기존 결제를 조회해요.` : walletErrorMessage(failure));
      }
    } finally {
      if (state.prepared && !state.submitted) {
        await api('cancel', undefined, AbortSignal.timeout(5000)).catch(() => undefined);
        purchaseRequests.current.delete(offer.listingId);
      } else if (!state.prepared && !state.submitted) purchaseRequests.current.delete(offer.listingId);
      if (activeRequest.current === request) { activeRequest.current = null; setPending(false); setPurchaseStatus(''); }
    }
  }

  function reset() {
    activeRequest.current?.abort();
    activeRequest.current = null;
    sessionId.current = undefined;
    setMessages([]);
    setDraft('');
    setError('');
    setPending(false);
    setStreamingText('');
    setPurchaseStatus('');
    setReceipts([]);
    setOpenedCard(null);
    followOutput.current = true;
    input.current?.focus();
  }

  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
      event.preventDefault(); event.currentTarget.form?.requestSubmit();
    }
  }
  return <Panel id="agent-panel" aria-labelledby="agent-heading" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose(); } }}>
    <PanelHeader><div><h2 id="agent-heading">거래 에이전트</h2><span>{demo.data?.enabled ? '카드 찾기 · 매물 확인 · 테스트넷 구매' : '카드 검색 및 적정가 조회'}</span></div><PanelActions><ResetButton type="button" disabled={!messages.length && !draft} onClick={reset} aria-label="대화 비우기" title="대화 비우기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></ResetButton><ResetButton type="button" onClick={onClose} aria-label="에이전트 닫기" title="에이전트 닫기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></ResetButton></PanelActions></PanelHeader>
    <History ref={history} onScroll={() => { const pane = history.current; if (pane) followOutput.current = pane.scrollHeight - pane.scrollTop - pane.clientHeight < 60; }} role="log" aria-label="에이전트 대화" aria-live="polite" aria-relevant="additions">
      {!messages.length && <Welcome><h3>어떤 카드를 찾고 있나요?</h3><p>{demo.data?.enabled ? '카드를 찾고 지금 구매할 수 있는 매물까지 확인해 보세요.' : '카드 이름이나 조회할 적정가를 물어보세요.'}</p><Suggestions aria-label="대화 예시">{examples.map(text => <Suggestion key={text} type="button" onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</Suggestion>)}</Suggestions></Welcome>}
      {messages.map((message, index) => (
        <Message key={index}>
          <span>{message.role === 'user' ? '나' : '에이전트'}</span>
          <MessageBody>
            {message.role === 'assistant' && !message.interrupted ? (
              <Suspense fallback={<PlainMessage role="status">답변을 표시하고 있어요.</PlainMessage>}>
                <AgentMarkdown content={message.content} />
              </Suspense>
            ) : <PlainMessage>{message.content}</PlainMessage>}
            {message.interrupted && <ReplyState>중단된 답변 · 완료되지 않은 내용이에요.</ReplyState>}
            {message.role === 'assistant' && message.cardChoices?.length ? <CardChoices cards={message.cardChoices} disabled={pending || index !== latestChoices} selectedId={message.selectedCardId} onSelect={card => { void selectCard(card, index); }} /> : null}
            {message.purchaseOffers?.length ? <PurchaseOffers offers={message.purchaseOffers} signingMode={demo.data?.signingMode} payer={demo.data?.payer} disabled={pending || index !== latestOffers} completedIds={receipts.filter(item => item.status === 'COMPLETED').map(item => item.listingId)} submittedIds={[...purchaseRequests.current.entries()].filter(([, item]) => item.submitted).map(([id]) => id)} onBuy={offer => { void buyOffer(offer); }} /> : null}
          </MessageBody>
        </Message>
      ))}
      {pending && streamingText && <Message aria-live="off"><span>에이전트</span><MessageBody><PlainMessage>{streamingText}</PlainMessage><ReplyState>답변을 작성하고 있어요.</ReplyState></MessageBody></Message>}
      {pending && !streamingText && <Waiting role="status">{purchaseStatus || '카드를 확인하고 답변을 준비하고 있어요.'}</Waiting>}
      {receipts.map(progress => <PurchaseReceipt key={progress.requestId} progress={progress} disabled={pending} onCheck={() => { void buyOffer({ listingId: progress.listingId, card: progress.card, price: progress.amount, dataSource: 'SYNTHETIC_DEMO', paymentMode: 'X402_BASE_SEPOLIA', paymentReady: true }); }} />)}
      {error && <Waiting role="alert">{error}</Waiting>}
    </History>
    <Composer onSubmit={submit}><label htmlFor="agent-message">에이전트에게 보낼 내용</label><InputBox><ChatInput ref={input} id="agent-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={keyDown} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} placeholder="카드 이름이나 조회할 내용" maxLength={2000} rows={3} aria-describedby="agent-connection-note" /><ComposerActions><span>{draft.length.toLocaleString()} / 2,000</span><SendButton type="submit" disabled={pending || !draft.trim()} aria-label="메시지 보내기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></SendButton></ComposerActions></InputBox><ConnectionNote id="agent-connection-note">카드 검색과 적정가를 조회할 수 있어요. 새로고침하면 새 대화로 시작해요.</ConnectionNote></Composer>
    {openedCard && (
      <Suspense fallback={null}>
        <CardOpening card={openedCard} onDismiss={() => setOpenedCard(null)} />
      </Suspense>
    )}
  </Panel>;
}

const Panel = styled.aside(({ theme }) => ({ display: 'flex', flexDirection: 'column', minWidth: 0, minHeight: 0, height: '100%', background: theme.color.surface, borderLeft: `1px solid ${theme.color.line}` }));
const messageEnter = keyframes({ from: { opacity: 0, transform: 'translateY(6px)' }, to: { opacity: 1, transform: 'translateY(0)' } });
const PanelActions = styled.div({ display: 'flex', gap: 4, alignItems: 'center' });
const PanelHeader = styled.div(({ theme }) => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '20px 24px', borderBottom: `1px solid ${theme.color.line}`, flexShrink: 0, '& h2': { fontSize: 16, fontWeight: 600 }, '& span': { fontSize: 12, color: theme.color.muted, display: 'block', marginTop: 4 }, '@media(max-height:600px)': { padding: '8px 20px' } }));
const ResetButton = styled.button(({ theme }) => ({ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', minWidth: 44, minHeight: 44, background: theme.color.surface, border: 0, color: theme.color.muted, '&:hover:not(:disabled)': { color: theme.color.ink }, '&:disabled': { opacity: .4 } }));
const History = styled.div({ flex: 1, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', padding: '28px 24px', overflowWrap: 'anywhere', '@media(max-height:600px)': { padding: '8px 20px' } });
const Welcome = styled.div(({ theme }) => ({ paddingTop: 32, '& h3': { fontSize: 23, fontWeight: 550, letterSpacing: '-.025em', textWrap: 'balance' }, '& p': { marginTop: 16, fontSize: 14, color: theme.color.muted, lineHeight: 1.8 } }));
const Suggestions = styled.div({ display: 'grid', gap: 10, marginTop: 28 });
const Suggestion = styled.button(({ theme }) => ({ textAlign: 'left', background: theme.color.surface, border: `1px solid ${theme.color.line}`, borderRadius: 6, minHeight: 48, padding: '12px 14px', color: theme.color.ink, fontSize: 13, '&:hover': { borderColor: theme.color.input } }));
const Message = styled.div(({ theme }) => ({ marginBottom: 24, animation: `${messageEnter} ${theme.motion.standard} ${theme.motion.ease} both`, '@media(prefers-reduced-motion:reduce)': { animation: 'none' }, '& > span': { display: 'block', color: theme.color.muted, fontSize: 12, marginBottom: 8 } }));
const MessageBody = styled.div(({ theme }) => ({ padding: '12px 14px', border: `1px solid ${theme.color.line}`, borderRadius: 8, fontSize: 14, lineHeight: 1.8 }));
const PlainMessage = styled.p({ margin: 0, whiteSpace: 'pre-wrap' });
const ReplyState = styled.small(({ theme }) => ({ display: 'block', marginTop: 10, fontSize: 12, color: theme.color.muted, lineHeight: 1.7 }));
const Waiting = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 13, lineHeight: 1.8, paddingBottom: 8 }));
const Composer = styled.form({ padding: '16px 24px max(20px, env(safe-area-inset-bottom))', flexShrink: 0, '& > label': { display: 'block', fontSize: 12, marginBottom: 8 }, '@media(max-height:600px)': { padding: '8px 20px max(8px, env(safe-area-inset-bottom))', '& > label': { marginBottom: 4 } } });
const InputBox = styled.div(({ theme }) => ({ border: `1px solid ${theme.color.input}`, borderRadius: 8, padding: '12px 12px 8px', '&:focus-within': { borderColor: theme.color.focus }, '@media(max-height:600px)': { padding: 8 } }));
const ChatInput = styled.textarea(({ theme }) => ({ display: 'block', width: '100%', minHeight: 76, maxHeight: 160, resize: 'vertical', border: 0, background: theme.color.surface, color: theme.color.ink, font: 'inherit', fontSize: 14, lineHeight: 1.7, '&::placeholder': { color: theme.color.muted }, '&:focus-visible': { outlineOffset: 2 }, '@media(max-width:899px)': { fontSize: 16 }, '@media(max-height:600px)': { height: 48, minHeight: 48, maxHeight: 48, resize: 'none' } }));
const ComposerActions = styled.div(({ theme }) => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, '& > span': { fontSize: 12, color: theme.color.muted }, '@media(max-height:600px)': { marginTop: 0 } }));
const SendButton = styled.button(({ theme }) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, border: 0, borderRadius: 6, color: theme.color.surface, background: theme.color.primary, '&:hover:not(:disabled)': { background: theme.color.primaryHover }, '&:disabled': { opacity: .4 } }));
const ConnectionNote = styled.p(({ theme }) => ({ fontSize: 12, color: theme.color.muted, lineHeight: 1.7, marginTop: 12, '@media(max-height:600px)': { marginTop: 8 } }));
