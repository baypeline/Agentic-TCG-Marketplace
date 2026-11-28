'use client';

import Link from 'next/link';
import { useWalletSession } from './use-wallet-session';
import styled from '@emotion/styled';
import { AgentWalletStatus } from './agent-wallet-status';

export function AgentWalletSetup() {
  const session = useWalletSession();
  return <Page><Back href="/agent">← 에이전트 설정</Back><h1>에이전트 지갑</h1><Description>지갑을 직접 만들거나 연결할 필요 없이, 로그인하면 계정 전용 지갑을 자동으로 준비해요.</Description>
    {session.isPending ? <p role="status">로그인 상태를 확인하고 있어요.</p> : session.isError ? <p role="alert">로그인 상태를 확인하지 못했어요. 새로고침해 주세요.</p> : session.data?.user ? <><AgentWalletStatus /><Back href="/agent">충전 주소를 확인했다면 구매 예산 설정하기 →</Back></> : <p>상단의 ‘지갑 로그인’을 누르면 에이전트 지갑을 확인할 수 있어요.</p>}
  </Page>;
}

const Page = styled.div({ maxWidth: 1040, margin: '0 auto', '& h1': { marginTop: 24, fontSize: 'clamp(28px,3vw,38px)', fontWeight: 600, letterSpacing: '-.035em' } });
const Description = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 15, lineHeight: 1.85, marginTop: 16 }));
const Back = styled(Link)(({ theme }) => ({ display: 'inline-flex', minHeight: 44, alignItems: 'center', color: theme.color.link, fontSize: 13, textUnderlineOffset: 4 }));
