'use client';

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import styled from '@emotion/styled';
import { keyframes } from '@emotion/react';

const suggestions = ['피카츄 카드를 찾고 싶어요', '거래 예산을 정하고 싶어요', '참고 시세를 확인하고 싶어요'];

export function AgentChat({ onClose }: { onClose: () => void }) {
  const [draft, setDraft] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const input = useRef<HTMLTextAreaElement>(null);
  const history = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  useEffect(() => { if (history.current) history.current.scrollTop = history.current.scrollHeight; }, [messages]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const message = draft.trim();
    if (!message || message.length > 2000) return;
    setMessages(current => [...current, message]); setDraft(''); input.current?.focus();
  }
  function keyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing && !composing.current && event.keyCode !== 229) {
      event.preventDefault(); event.currentTarget.form?.requestSubmit();
    }
  }
  return <Panel id="agent-panel" aria-labelledby="agent-heading" onKeyDown={event => { if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); onClose(); } }}>
    <PanelHeader><div><h2 id="agent-heading">거래 에이전트</h2><span>대화 UI 미리보기</span></div><PanelActions><ResetButton type="button" disabled={!messages.length && !draft} onClick={() => { setMessages([]); setDraft(''); input.current?.focus(); }} aria-label="대화 비우기" title="대화 비우기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></ResetButton><ResetButton type="button" onClick={onClose} aria-label="에이전트 닫기" title="에이전트 닫기"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m6 6 12 12M6 18 18 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg></ResetButton></PanelActions></PanelHeader>
    <History ref={history} role="log" aria-label="에이전트 대화" aria-live="polite" aria-relevant="additions">
      {!messages.length && <Welcome><h3>어떤 거래를 생각하고 있나요?</h3><p>찾는 카드나 예산을 적어보세요. 거래 조건을 이야기할 수 있는 공간이에요.</p><Suggestions aria-label="대화 예시">{suggestions.map(text => <Suggestion key={text} type="button" onClick={() => { setDraft(text); input.current?.focus(); }}>{text}</Suggestion>)}</Suggestions></Welcome>}
      {messages.map((message, index) => <Message key={index}><span>나</span><p>{message}</p></Message>)}
      {messages.length > 0 && <Waiting>아직 Agent에 전송되지 않았어요. 현재는 대화 화면만 확인할 수 있어요.</Waiting>}
    </History>
    <Composer onSubmit={submit}><label htmlFor="agent-message">에이전트에게 보낼 내용</label><InputBox><ChatInput ref={input} id="agent-message" value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={keyDown} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }} placeholder="찾는 카드와 거래 조건을 적어주세요" maxLength={2000} rows={3} aria-describedby="agent-connection-note" /><ComposerActions><span>{draft.length.toLocaleString()} / 2,000</span><SendButton type="submit" disabled={!draft.trim()} aria-label="메시지 보내기"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 19V5m-6 6 6-6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></SendButton></ComposerActions></InputBox><ConnectionNote id="agent-connection-note">Agent 연결 전이라 답변과 주문·결제는 실행되지 않아요. 새로고침하면 대화가 지워져요.</ConnectionNote></Composer>
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
const Message = styled.div(({ theme }) => ({ marginBottom: 24, animation: `${messageEnter} ${theme.motion.standard} ${theme.motion.ease} both`, '@media(prefers-reduced-motion:reduce)': { animation: 'none' }, '& > span': { display: 'block', color: theme.color.muted, fontSize: 12, marginBottom: 8 }, '& p': { whiteSpace: 'pre-wrap', padding: '12px 14px', border: `1px solid ${theme.color.line}`, borderRadius: 8, fontSize: 14, lineHeight: 1.8 } }));
const Waiting = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 13, lineHeight: 1.8, paddingBottom: 8 }));
const Composer = styled.form({ padding: '16px 24px max(20px, env(safe-area-inset-bottom))', flexShrink: 0, '& > label': { display: 'block', fontSize: 12, marginBottom: 8 }, '@media(max-height:600px)': { padding: '8px 20px max(8px, env(safe-area-inset-bottom))', '& > label': { marginBottom: 4 } } });
const InputBox = styled.div(({ theme }) => ({ border: `1px solid ${theme.color.input}`, borderRadius: 8, padding: '12px 12px 8px', '&:focus-within': { borderColor: theme.color.focus }, '@media(max-height:600px)': { padding: 8 } }));
const ChatInput = styled.textarea(({ theme }) => ({ display: 'block', width: '100%', minHeight: 76, maxHeight: 160, resize: 'vertical', border: 0, background: theme.color.surface, color: theme.color.ink, font: 'inherit', fontSize: 14, lineHeight: 1.7, '&::placeholder': { color: theme.color.muted }, '&:focus-visible': { outlineOffset: 2 }, '@media(max-width:899px)': { fontSize: 16 }, '@media(max-height:600px)': { height: 48, minHeight: 48, maxHeight: 48, resize: 'none' } }));
const ComposerActions = styled.div(({ theme }) => ({ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 8, '& > span': { fontSize: 12, color: theme.color.muted }, '@media(max-height:600px)': { marginTop: 0 } }));
const SendButton = styled.button(({ theme }) => ({ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, border: 0, borderRadius: 6, color: theme.color.surface, background: theme.color.primary, '&:hover:not(:disabled)': { background: theme.color.primaryHover }, '&:disabled': { opacity: .4 } }));
const ConnectionNote = styled.p(({ theme }) => ({ fontSize: 12, color: theme.color.muted, lineHeight: 1.7, marginTop: 12, '@media(max-height:600px)': { marginTop: 8 } }));
