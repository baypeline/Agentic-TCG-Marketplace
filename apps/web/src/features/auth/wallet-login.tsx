'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import styled from '@emotion/styled';
import type { EIP1193Provider } from 'viem';
import { getWalletSession, loginWallet, logoutWallet, walletQueryKey } from './wallet-client';
import { needsAgentWalletSetup, useAgentWalletSetupStore } from '../../stores/agent-wallet-setup';

type BrowserWallet = EIP1193Provider & { on?(name: string, callback: (...args: unknown[]) => void): void; removeListener?(name: string, callback: (...args: unknown[]) => void): void };
export function WalletLogin() {
  const client = useQueryClient(), router = useRouter();
  const session = useQuery({ queryKey: walletQueryKey, queryFn: getWalletSession, staleTime: 30_000, refetchInterval: 60_000, retry: false });
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const user = session.data?.user;
  async function signOut() {
    setBusy(true); setError('');
    try { await logoutWallet(); client.clear(); client.setQueryData(walletQueryKey, { user: null }); router.refresh(); }
    catch { setError('로그아웃하지 못했어요. 다시 시도해 주세요.'); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    const wallet = (window as Window & { ethereum?: BrowserWallet }).ethereum;
    if (!wallet || !user) return;
    const changed = (...args: unknown[]) => { const accounts = args[0]; if (!Array.isArray(accounts) || !accounts.some(address => typeof address === 'string' && address.toLowerCase() === user.address.toLowerCase())) void signOut(); };
    const disconnect = () => { void signOut(); };
    wallet.on?.('accountsChanged', changed); wallet.on?.('disconnect', disconnect);
    return () => { wallet.removeListener?.('accountsChanged', changed); wallet.removeListener?.('disconnect', disconnect); };
  }, [user?.address]);
  async function signIn() {
    setBusy(true); setError('');
    try {
      const provider = (window as Window & { ethereum?: BrowserWallet }).ethereum;
      if (!provider) throw new Error('MetaMask 등 브라우저 지갑을 설치해 주세요.');
      const result = await loginWallet(provider);
      try { await useAgentWalletSetupStore.persist.rehydrate(); } catch { /* 로그인은 브라우저 저장소 사용 여부와 무관하게 유지한다. */ }
      const setup = useAgentWalletSetupStore.getState();
      const showSetup = needsAgentWalletSetup(result.user, setup.visitedUsers);
      if (showSetup) { try { setup.markVisited(result.user!.userId); } catch { /* 저장 실패는 로그인과 설정 안내 진입을 막지 않는다. */ } }
      client.clear(); client.setQueryData(walletQueryKey, result);
      if (showSetup) router.push('/agent/wallet'); else router.refresh();
    } catch (failure) { setError((failure as { code?: number }).code === 4001 ? '로그인 서명을 취소했어요.' : failure instanceof Error && !('details' in failure) ? failure.message : '지갑 연결과 로그인 서명을 확인해 주세요.'); }
    finally { setBusy(false); }
  }
  return <Root>{user ? <><Address title={user.address}>{user.address.slice(0, 6)}…{user.address.slice(-4)}</Address><Button type="button" disabled={busy} onClick={() => void signOut()}>로그아웃</Button></> : <Button type="button" disabled={busy || session.isPending} onClick={() => void signIn()}>{busy ? '지갑 확인 중…' : '지갑 로그인'}</Button>}{error && <ErrorText role="alert">{error}</ErrorText>}</Root>;
}

const Root = styled.div({ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8, position: 'relative' });
const Address = styled.span({ fontSize: 12, fontVariantNumeric: 'tabular-nums', '@media(max-width:479px)': { display: 'none' } });
const Button = styled.button(({ theme }) => ({ minHeight: 44, padding: '8px 12px', background: theme.color.surface, color: theme.color.ink, border: `1px solid ${theme.color.line}`, borderRadius: 6, fontSize: 13, whiteSpace: 'nowrap', '&:disabled': { opacity: .5 }, '&:hover:not(:disabled)': { borderColor: theme.color.primary } }));
const ErrorText = styled.p(({ theme }) => ({ position: 'absolute', top: '100%', right: 0, marginTop: 4, padding: 12, maxWidth: 280, minWidth: 200, background: theme.color.surface, border: `1px solid ${theme.color.line}`, fontSize: 12, lineHeight: 1.6, zIndex: 30 }));
