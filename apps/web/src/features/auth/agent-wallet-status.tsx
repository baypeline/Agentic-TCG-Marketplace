'use client';

import { useState } from 'react';
import { useWalletSession } from './use-wallet-session';
import styled from '@emotion/styled';
import { useQuery } from '@tanstack/react-query';
import { agentWalletInfoSchema } from '@tcg/contracts';
import { getAgentWallet } from './wallet-client';
import { formatUsdc } from '../../lib/formatters';

type Info = ReturnType<typeof agentWalletInfoSchema.parse>;
export function AgentWalletStatus({ compact = false }: { compact?: boolean }) {
  const session = useWalletSession();
  const wallet = useQuery({ queryKey: ['agent-wallet', session.data?.user?.userId], queryFn: getAgentWallet, enabled: !!session.data?.user, refetchInterval: 15_000, retry: false });
  if (!session.data?.user) return null;
  return <AgentWalletFundingCard compact={compact} info={wallet.data} address={session.data.user.agentWalletAddress} loading={wallet.isPending} failed={wallet.isError} onRefresh={() => void wallet.refetch()} />;
}
export function AgentWalletFundingCard({ info, address, loading, failed, onRefresh, compact = false }: { compact?: boolean; info?: Info; address?: string; loading: boolean; failed: boolean; onRefresh(): void }) {
  const [notice, setNotice] = useState('');
  const payer = info?.address ?? address;
  async function copy() {
    if (!payer) return;
    try { await navigator.clipboard.writeText(payer); setNotice('지갑 주소를 복사했어요.'); }
    catch { setNotice('주소를 직접 선택해 복사해 주세요.'); }
  }
  return <Card id="agent-wallet-funding" aria-label="에이전트 지갑 충전">
    <Heading><div><h2>내 에이전트 지갑</h2><p>{info?.balance !== null && info?.balance !== undefined ? BigInt(info.balance) > 0n ? '지갑이 생성되고 충전됐어요. 결제 금액과 가스비를 이 지갑에서 사용해요.' : '지갑이 생성됐어요. 아래 주소로 구매 금액과 가스비를 충전해 주세요.' : '로그인 계정의 전용 지갑과 잔액을 확인해요.'}</p></div><Refresh type="button" disabled={loading} onClick={onRefresh}>잔액 새로고침</Refresh></Heading>
    <Facts><div><dt>네트워크</dt><dd>{info?.network ?? (failed ? '조회 실패' : '확인 중')}</dd></div><div><dt>지갑 잔액</dt><dd>{info?.balance !== null && info?.balance !== undefined ? formatUsdc(info.balance, info.currency) : loading ? '확인 중' : '잔액 조회 실패'}</dd></div></Facts>
    <FundingDetails id="agent-wallet-address" open={!compact || info?.balance === '0'}><summary>{info?.balance === '0' ? '충전이 필요해요 · 주소 확인' : '충전 주소와 안내'}</summary>
    {payer ? <AddressRow><Address>{payer}</Address><Copy type="button" onClick={() => void copy()}>주소 복사</Copy></AddressRow> : <p role={failed ? 'alert' : 'status'}>{failed ? '지갑을 확인하지 못했어요. 다시 조회해 주세요.' : '에이전트 지갑을 확인하고 있어요.'}</p>}
    {notice && <Note role="status">{notice}</Note>}
    <Note>충전은 지갑 잔액에 반영돼요. 자동 구매에 사용할 총예산과 건당 한도는 별도로 정해 주세요.</Note>
    </FundingDetails>
    {failed && payer && <Note role="alert">지갑 주소는 확인했지만 최신 잔액을 가져오지 못했어요.</Note>}
  </Card>;
}

const FundingDetails = styled.details(({ theme }) => ({ marginTop: 16, '& > summary': { minHeight: 44, paddingBlock: 10, cursor: 'pointer', color: theme.color.ink, fontSize: 14 } }));
const Card = styled.section(({ theme }) => ({ marginBlock: 24, padding: 28, border: `1px solid ${theme.color.line}`, borderRadius: theme.radius.panel, '@media(max-width:639px)': { padding: 20 } }));
const Heading = styled.div(({ theme }) => ({ display: 'flex', justifyContent: 'space-between', alignItems: 'start', flexWrap: 'wrap', gap: 16, '& h2': { fontSize: 19, fontWeight: 600 }, '& p': { maxWidth: 620, fontSize: 14, color: theme.color.muted, marginTop: 10, lineHeight: 1.85 } }));
const AddressRow = styled.div({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12, marginTop: 24 });
const Address = styled.code(({ theme }) => ({ flex: '1 1 240px', minWidth: 0, padding: '14px 16px', background: theme.color.soft, borderRadius: 6, fontSize: 14, lineHeight: 1.7, overflowWrap: 'anywhere', userSelect: 'all' }));
const Copy = styled.button(({ theme }) => ({ minHeight: 46, padding: '10px 18px', border: 0, borderRadius: 6, background: theme.color.primary, color: theme.color.surface, fontSize: 13, fontWeight: 600, '&:hover': { background: theme.color.primaryHover } }));
const Refresh = styled.button(({ theme }) => ({ minHeight: 44, padding: '8px 12px', border: `1px solid ${theme.color.line}`, borderRadius: 6, color: theme.color.ink, background: theme.color.surface, fontSize: 13, '&:disabled': { opacity: .5 } }));
const Facts = styled.dl(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', gap: '20px 48px', marginTop: 24, '& dt': { color: theme.color.muted, fontSize: 12 }, '& dd': { margin: '6px 0 0', fontSize: 16, fontWeight: 600 } }));
const Note = styled.p(({ theme }) => ({ color: theme.color.muted, fontSize: 12, lineHeight: 1.8, marginTop: 16 }));
