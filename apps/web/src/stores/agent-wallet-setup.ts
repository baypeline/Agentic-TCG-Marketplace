'use client';

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

interface WalletSetupState {
  visitedUsers: string[];
  markVisited(userId: string): void;
}
const validUserId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function createAgentWalletSetupStore(storage?: StateStorage) {
  return create<WalletSetupState>()(persist(
    set => ({ visitedUsers: [], markVisited: userId => {
      if (validUserId(userId)) set(state => ({ visitedUsers: [...state.visitedUsers.filter(id => id !== userId), userId].slice(-100) }));
    } }),
    { name: 'tcg-agent-wallet-setup', version: 1, storage: createJSONStorage(() => storage ?? localStorage), skipHydration: true,
      partialize: ({ visitedUsers }) => ({ visitedUsers }),
      merge: (saved, current) => ({ ...current, visitedUsers: typeof saved === 'object' && saved !== null && 'visitedUsers' in saved && Array.isArray(saved.visitedUsers) ? [...new Set(saved.visitedUsers.filter(validUserId))].slice(-100) : [] }),
    },
  ));
}
export const useAgentWalletSetupStore = createAgentWalletSetupStore();
export function needsAgentWalletSetup(user: { userId: string; agentWalletLinked: boolean } | null | undefined, visitedUsers: readonly string[]) {
  return !!user && !user.agentWalletLinked && !visitedUsers.includes(user.userId);
}
