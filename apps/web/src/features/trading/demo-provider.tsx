'use client';

import { createContext, useContext, useReducer, type ReactNode } from 'react';
import { demoReducer, initialDemoState, type DemoAction, type DemoState } from './demo-model';

const DemoContext = createContext<{ state: DemoState; dispatch: (action: DemoAction) => void } | null>(null);

export function DemoTradingProvider({ children }: { children: ReactNode }) {
  const [state, reduce] = useReducer(demoReducer, undefined, initialDemoState);
  function dispatch(action: DemoAction) { reduce({ ...action, at: new Date().toISOString(), logId: crypto.randomUUID() }); }
  return <DemoContext.Provider value={{ state, dispatch }}>{children}</DemoContext.Provider>;
}
export function useDemoTrading() { const context = useContext(DemoContext); if (!context) throw new Error('DemoTradingProvider가 필요합니다.'); return context; }
