'use client';
import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getWalletSession, walletQueryKey } from './wallet-client';
const subscribe = () => () => {};
const browserSnapshot = () => true;
const serverSnapshot = () => false;

// 캐시가 먼저 채워져도 서버 HTML과 첫 클라이언트 렌더는 같은 상태를 유지한다.
export function useWalletSession(poll = false) {
  const hydrated = useSyncExternalStore(subscribe, browserSnapshot, serverSnapshot);
  const query = useQuery({ queryKey: walletQueryKey, queryFn: getWalletSession, enabled: hydrated, staleTime: 30_000, refetchInterval: poll ? 60_000 : false, retry: false });
  return { ...query, data: hydrated ? query.data : undefined, isPending: !hydrated || query.isPending, isError: hydrated && query.isError };
}
