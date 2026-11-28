'use client';
import { useQuery } from '@tanstack/react-query';
import { useWalletSession } from './use-wallet-session';
import { agentBudgetStateSchema } from '@tcg/contracts';
export const agentBudgetKey = ['agent-budget'] as const;
export function useAgentBudget() {
  const session = useWalletSession();
  return useQuery({ queryKey: [...agentBudgetKey, session.data?.user?.userId], enabled: !!session.data?.user, queryFn: async () => {
    const result = await fetch('/api/agent-budget', { cache: 'no-store' }); const data = await result.json();
    if (!result.ok) throw new Error(data.message ?? '예산을 확인하지 못했어요.');
    return agentBudgetStateSchema.parse(data);
  }, retry: false, staleTime: 5000, refetchOnWindowFocus: true });
}
