'use client';

import { create } from 'zustand';
import { createJSONStorage, persist, type StateStorage } from 'zustand/middleware';

interface AgentPanelState {
  chatOpen: boolean;
  setChatOpen: (open: boolean) => void;
}

export function createAgentPanelStore(storage?: StateStorage) {
  return create<AgentPanelState>()(persist(
    set => ({ chatOpen: false, setChatOpen: chatOpen => set({ chatOpen }) }),
    {
      name: 'tcg-agent-panel', version: 1,
      storage: createJSONStorage(() => storage ?? localStorage),
      partialize: ({ chatOpen }) => ({ chatOpen }),
      // 서버와 첫 클라이언트 렌더는 닫힘으로 맞춘 뒤 마운트 시 복원한다.
      skipHydration: true,
      merge: (saved, current) => ({ ...current, chatOpen: typeof saved === 'object' && saved !== null && 'chatOpen' in saved && saved.chatOpen === true }),
    },
  ));
}

export const useAgentPanelStore = createAgentPanelStore();
