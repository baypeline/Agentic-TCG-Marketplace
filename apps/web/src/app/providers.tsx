'use client';

import type { ReactNode } from 'react';
import { ThemeProvider } from '@emotion/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { EmotionRegistry } from '../styles/emotion-registry';
import { GlobalStyles } from '../styles/global-styles';
import { theme } from '../styles/theme';
import { DemoTradingProvider } from '../features/trading/demo-provider';
import { getQueryClient } from '../lib/query-client';

export function Providers({ children }: { children: ReactNode }) {
  const queryClient = getQueryClient();
  return <QueryClientProvider client={queryClient}><EmotionRegistry><ThemeProvider theme={theme}><GlobalStyles /><DemoTradingProvider>{children}</DemoTradingProvider></ThemeProvider></EmotionRegistry></QueryClientProvider>;
}
