'use client';

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

interface WalletSetupState {
  visitedUsers: string[];
  visitedWallets: Record<string, string>;
  markVisited(userId: string, address?: string): void;
}
const validUserId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export function createAgentWalletSetupStore(storage?: StateStorage) {
  return create<WalletSetupState>()(persist(
    set => ({ visitedUsers: [], visitedWallets: {}, markVisited: (userId, address) => {
      if (validUserId(userId)) set(state => ({ visitedUsers: [...state.visitedUsers.filter(id => id !== userId), userId].slice(-100), visitedWallets: Object.fromEntries([...Object.entries(state.visitedWallets).filter(([id]) => id !== userId), ...(address ? [[userId, address.toLowerCase()]] : [])].slice(-100)) }));
    } }),
    { name: 'tcg-agent-wallet-setup', version: 1, storage: createJSONStorage(() => storage ?? localStorage), skipHydration: true,
      partialize: ({ visitedUsers, visitedWallets }) => ({ visitedUsers, visitedWallets }),
      merge: (saved, current) => ({ ...current, visitedWallets: typeof saved === 'object' && saved !== null && 'visitedWallets' in saved && typeof saved.visitedWallets === 'object' && saved.visitedWallets !== null ? Object.fromEntries(Object.entries(saved.visitedWallets).filter(([id, value]) => validUserId(id) && typeof value === 'string' && /^0x[\da-fA-F]{40}$/.test(value)).slice(-100)) : {}, visitedUsers: typeof saved === 'object' && saved !== null && 'visitedUsers' in saved && Array.isArray(saved.visitedUsers) ? [...new Set(saved.visitedUsers.filter(validUserId))].slice(-100) : [] }),
    },
  ));
}
export const useAgentWalletSetupStore = createAgentWalletSetupStore();
export function needsAgentWalletSetup(user: { userId: string; agentWalletLinked: boolean; agentWalletAddress?: string } | null | undefined, visitedUsers: readonly string[], visitedWallets: Readonly<Record<string, string>> = {}) {
  return !!user && (user.agentWalletAddress ? visitedWallets[user.userId] !== user.agentWalletAddress.toLowerCase() : !user.agentWalletLinked && !visitedUsers.includes(user.userId));
}
