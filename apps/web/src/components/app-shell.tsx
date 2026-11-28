'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styled from '@emotion/styled';
import { useTheme } from '@emotion/react';
import { useQuery } from '@tanstack/react-query';
import { demoStatusSchema } from '@tcg/contracts';
import { AgentChat } from '../features/chat/agent-chat';
import { useAgentPanelStore } from '../stores/agent-panel';
import { WalletLogin } from '../features/auth/wallet-login';
import { getWalletSession, walletQueryKey } from '../features/auth/wallet-client';

export function AppShell({ children }: { children: ReactNode }) {
  const { color } = useTheme();
  const pathname = usePathname();
  const wallet = useQuery({ queryKey: walletQueryKey, queryFn: getWalletSession, staleTime: 30_000, retry: false });
  const demo = useQuery({ queryKey: ['demo-status'], queryFn: async () => { const response = await fetch('/api/demo'); if (!response.ok) throw new Error('Unavailable'); return demoStatusSchema.parse(await response.json()); }, staleTime: Infinity, retry: false });
  const chatOpen = useAgentPanelStore(state => state.chatOpen);
  const setChatOpen = useAgentPanelStore(state => state.setChatOpen);
  const isLanding = pathname === '/';
  const chatToggle = useRef<HTMLButtonElement>(null);
  const browse = useRef<HTMLDivElement>(null);
  useEffect(() => { void useAgentPanelStore.persist?.rehydrate(); }, []);
  useEffect(() => { if (browse.current) browse.current.scrollTop = 0; }, [pathname]);
  function closeChat() { setChatOpen(false); chatToggle.current?.focus({ preventScroll: true }); }
  function toggleChat() {
    if (chatOpen) { closeChat(); return; }
    setChatOpen(true);
    requestAnimationFrame(() => document.getElementById('agent-message')?.focus({ preventScroll: true }));
  }
  return <>
    <SkipLink href={chatOpen ? '#agent-message' : '#main-content'}>{chatOpen ? '대화 입력으로 바로가기' : '본문으로 바로가기'}</SkipLink>
    <Header><HeaderInner data-chat-open={chatOpen}><Brand href="/" aria-label="Agentic TCG 홈">
      <svg width="30" height="36" viewBox="0 0 30 36" fill="none" aria-hidden="true"><rect x="1" y="6" width="21" height="28" rx="2" stroke={color.ink} /><rect x="8" y="1" width="21" height="28" rx="2" fill={color.coral} /><path d="m18.5 9 5 6-5 6-5-6 5-6Z" stroke={color.surface} strokeWidth="1.5" /></svg>
      Agentic TCG</Brand><AccountArea><WalletLogin /></AccountArea><Navigation aria-label="주요 메뉴"><Link href={isLanding ? '/cards' : '/'}>{isLanding ? <>마켓<NavDetail> 둘러보기</NavDetail></> : '홈'}</Link><ChatToggle ref={chatToggle} type="button" aria-controls="agent-panel" aria-expanded={chatOpen} onClick={toggleChat}>에이전트 {chatOpen ? '닫기' : '열기'}</ChatToggle></Navigation>
    </HeaderInner></Header>
    <Workspace data-chat-open={chatOpen}><BrowsePane ref={browse} id="browse-pane">
    {!isLanding && <ServiceNav aria-label="서비스 메뉴"><ServiceNavInner>{[['/cards', '카드 검색'], ['/marketplace', '매물'], ['/collection', '내 카드'], ['/agent', '에이전트 설정']].map(([href, label]) => <Link key={href} href={href!} aria-current={(pathname === href || href === '/agent' && pathname === '/agent/wallet' || href === '/cards' && pathname.startsWith('/cards/')) ? 'page' : undefined}>{label}</Link>)}<MoreMenu><summary aria-label="추가 메뉴">더보기</summary><MoreLinks>{[['/activity', '거래 내역'], ['/rwa', 'NFT 관리'], ['/agent/logs', '에이전트 로그']].map(([href, label]) => <Link key={href} href={href!} aria-current={pathname === href ? 'page' : undefined} onClick={event => event.currentTarget.closest('details')?.removeAttribute('open')}>{label}</Link>)}</MoreLinks></MoreMenu></ServiceNavInner></ServiceNav>}
    <PageFrame key={wallet.data?.user?.userId ?? 'anonymous'} id="main-content" tabIndex={-1}>{children}</PageFrame>
    <Footer id="data-guide"><FooterBrand>Agentic TCG</FooterBrand><details><summary>서비스 안내</summary>
      <p>영어판의 한국어 이름은 포켓몬 종명 표기이며, 한국어판은 원문 이름을 표시합니다. 해외 참고 시세는 제공자의 집계·판매 희망 가격으로, 한국어판 실거래가와 다를 수 있습니다.</p>
      <p>이 서비스는 테스트넷에서 실행되며, 매물·가격·보관 기록에는 시연용 데이터가 포함돼요. 구매하면 {demo.data?.paymentChain === 'maroo' ? 'Maroo Testnet tOKRW' : 'Base Sepolia 테스트 USDC'}와 NFT가 실제로 이동합니다. NFT 이전은 NFT 매물에만 해당해요.</p>
      <p>실물 카드의 보관·감정·배송은 제공하지 않으며, 인출 기능은 절차를 체험하는 용도예요. 참고 가격은 실제 시세나 체결가를 보장하지 않아요. {demo.data?.paymentChain === 'maroo' ? 'tOKRW 참고 가격은 시연용 기준으로, 원화 실거래가를 뜻하지 않아요.' : 'USD 기준 추정가는 1 USD ≈ 1 USDC로 표시하며 판본·보존 상태를 보정하지 않습니다.'} ‘화면 미리보기’의 기록은 예시입니다.</p>
    </details></Footer></BrowsePane><ChatPane inert={!chatOpen} aria-hidden={!chatOpen}><AgentChat key={wallet.data?.user?.userId ?? 'anonymous'} onClose={closeChat} /></ChatPane></Workspace>
  </>;
}

const SkipLink = styled.a(({ theme }) => ({ position: 'fixed', top: -80, left: 16, zIndex: 100, padding: 12, color: theme.color.surface, background: theme.color.ink, '&:focus': { top: 8 } }));
const Header = styled.header(({ theme }) => ({ position: 'sticky', top: 0, zIndex: 20, height: 72, background: theme.color.canvas, borderBottom: `1px solid ${theme.color.line}`, '@media(max-width:639px)': { height: 112 } }));
const HeaderInner = styled.div({ maxWidth: 1280, margin: '0 auto', padding: '0 32px', minHeight: 71, display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto auto', alignItems: 'center', gap: 20, '@media(max-width:639px)': { gridTemplateColumns: 'minmax(0,1fr) auto', padding: '8px 20px', minHeight: 111, gap: '4px 12px' } });
const Brand = styled(Link)(({ theme }) => ({ display: 'flex', alignItems: 'center', gap: 10, color: theme.color.ink, fontSize: 19, fontWeight: 650, textDecoration: 'none', whiteSpace: 'nowrap', '@media(max-width:639px)': { fontSize: 16, gap: 7 } }));
const Navigation = styled.nav(({ theme }) => ({ display: 'flex', alignItems: 'center', gap: 24, '& a': { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', minWidth: 44, minHeight: 44, color: theme.color.ink, fontSize: 14, fontWeight: 650, textDecoration: 'none', padding: '12px 0', '&[aria-current=page]': { textDecoration: 'underline', textUnderlineOffset: 8 }, '&:hover': { textDecoration: 'underline' } }, '@media(max-width:639px)': { gridColumn: '1 / -1', width: '100%', justifyContent: 'space-between', gap: 8, '& a': { fontSize: 13 } } }));
const ChatToggle = styled.button(({ theme }) => ({ minHeight: 44, padding: '8px 14px', border: `1px solid ${theme.color.line}`, borderRadius: 6, background: theme.color.surface, color: theme.color.ink, fontSize: 13, whiteSpace: 'nowrap', '@media(max-width:639px)': { paddingInline: 10, fontSize: 12 } }));
const AccountArea = styled.div({ justifySelf: 'end', minWidth: 0 });
const MoreMenu = styled.details(({ theme }) => ({ position: 'relative', flexShrink: 0, '& summary': { cursor: 'pointer', minHeight: 52, minWidth: 52, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: theme.color.ink, listStyle: 'none', '&::-webkit-details-marker': { display: 'none' } }, '&[open] summary': { color: theme.color.primary } }));
const MoreLinks = styled.div(({ theme }) => ({ position: 'absolute', top: '100%', right: 0, zIndex: 30, minWidth: 170, display: 'grid', padding: 8, background: theme.color.surface, border: `1px solid ${theme.color.line}`, borderRadius: 8, boxShadow: '0 8px 24px rgba(36,33,45,.08)', '& a': { paddingInline: 12, border: 0 } }));
const NavDetail = styled.span({ '@media(max-width:639px)': { display: 'none' } });
const Workspace = styled.div(({ theme }) => ({
  display: 'grid', gridTemplateColumns: 'minmax(0,1fr) 0px', height: 'calc(100dvh - 72px)', minHeight: 0, overflow: 'hidden',
  transition: `grid-template-columns ${theme.motion.panel} ${theme.motion.ease}`,
  '&[data-chat-open=true]': { gridTemplateColumns: 'minmax(0,1fr) 360px' },
  '@media(max-width:899px)': { gridTemplateColumns: 'minmax(0,1fr)', '&[data-chat-open=true]': { gridTemplateColumns: 'minmax(0,1fr)' }, '&[data-chat-open=true] > #browse-pane': { visibility: 'hidden', pointerEvents: 'none' } },
  '@media(max-width:639px)': { height: 'calc(100dvh - 112px)' },
  '@media(prefers-reduced-motion:reduce)': { transition: 'none' },
}));
const ChatPane = styled.div(({ theme }) => ({
  minWidth: 0, minHeight: 0, overflow: 'hidden', opacity: 0, visibility: 'hidden', transform: 'translateX(20px)',
  transition: `opacity ${theme.motion.standard} ease, transform ${theme.motion.panel} ${theme.motion.ease}, visibility 0s linear ${theme.motion.panel}`,
  '& > aside': { width: 360 },
  '[data-chat-open=true] > &': { opacity: 1, visibility: 'visible', transform: 'translateX(0)', transitionDelay: '0s' },
  '@media(max-width:899px)': { gridArea: '1 / 1', transform: 'translateX(12px)', '& > aside': { width: '100%', borderLeft: 0 } },
  '@media(prefers-reduced-motion:reduce)': { transform: 'none', transition: 'none' },
}));
const BrowsePane = styled.div({ minWidth: 0, minHeight: 0, overflowY: 'auto', overscrollBehavior: 'contain', containerType: 'inline-size', containerName: 'browse', scrollPaddingTop: 80, '@media(max-width:899px)': { gridArea: '1 / 1' } });
const ServiceNav = styled.nav(({ theme }) => ({ position: 'sticky', top: 0, zIndex: 10, background: theme.color.surface, borderBottom: `1px solid ${theme.color.line}` }));
const ServiceNavInner = styled.div(({ theme }) => ({ display: 'flex', gap: 24, width: '100%', maxWidth: 1280, margin: '0 auto', minHeight: 52, padding: '0 32px', overflow: 'visible',  '& a': { display: 'inline-flex', alignItems: 'center', flexShrink: 0, minHeight: 52, color: theme.color.muted, fontSize: 13, textDecoration: 'none', whiteSpace: 'nowrap', borderBottom: '2px solid transparent' }, '& a[aria-current=page]': { color: theme.color.ink, borderBottomColor: theme.color.ink }, '& a:hover': { color: theme.color.link }, '@media(max-width:639px)': { paddingInline: 12, gap: 0, justifyContent: 'space-between', '& > a': { fontSize: 12, paddingInline: 5 } } }));
const PageFrame = styled.main({ maxWidth: 1280, margin: '0 auto', padding: '32px 32px 48px', minHeight: 'calc(100svh - 190px)', '&:focus': { outline: 'none' }, '@media(max-width:639px)': { padding: '28px 20px 40px' } });
const Footer = styled.footer(({ theme }) => ({ width: 'calc(100% - 64px)', maxWidth: 1216, margin: '0 auto', padding: '28px 0 36px', borderTop: `1px solid ${theme.color.line}`, color: theme.color.muted, fontSize: 13, display: 'flex', justifyContent: 'space-between', gap: 32, '& summary': { cursor: 'pointer', minHeight: 44, paddingBlock: 10, color: theme.color.ink }, '& details': { maxWidth: 700 }, '& p': { marginTop: 10 }, '@media(max-width:639px)': { width: 'calc(100% - 40px)', display: 'block' } }));
const FooterBrand = styled.strong(({ theme }) => ({ color: theme.color.ink, fontSize: 16, paddingTop: 8 }));
