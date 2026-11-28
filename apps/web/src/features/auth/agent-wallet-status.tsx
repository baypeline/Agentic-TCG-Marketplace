'use client';

import Link from 'next/link';
import styled from '@emotion/styled';
import { useQuery } from '@tanstack/react-query';
import { getWalletSession, walletQueryKey } from './wallet-client';

export function AgentWalletStatus() {
  const session = useQuery({ queryKey: walletQueryKey, queryFn: getWalletSession, staleTime: 30_000, retry: false });
  if (!session.data?.user) return null;
  return <StatusCard><div><h2>에이전트 지갑 <span>{session.data.user.agentWalletLinked ? '연결됨' : '미연결'}</span></h2><p>{session.data.user.agentWalletLinked ? '구매에 사용할 지갑과 결제 네트워크를 확인하세요.' : '구매를 맡기려면 전용 결제 지갑이 필요해요. 예산은 먼저 설정할 수 있어요.'}</p></div><SettingsLink href="/agent/wallet">{session.data.user.agentWalletLinked ? '지갑 정보 보기' : '지갑 연결 안내'}</SettingsLink></StatusCard>;
}

const StatusCard = styled.section(({ theme }) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '16px 24px', marginBlock: 24, padding: '20px 24px', border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.panel, '& h2': { fontSize: 17, fontWeight: 600, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }, '& h2 span': { fontSize: 12, fontWeight: 400, color: theme.color.muted }, '& p': { fontSize: 13, color: theme.color.muted, marginTop: 8, lineHeight: 1.8 } }));
const SettingsLink = styled(Link)(({ theme }) => ({ minHeight: 44, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '8px 14px', border: `1px solid ${theme.color.input}`, color: theme.color.ink, fontSize: 13, borderRadius: 6, textDecoration: 'none', '&:hover': { borderColor: theme.color.primary, color: theme.color.link } }));
