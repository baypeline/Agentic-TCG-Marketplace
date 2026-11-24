import type { ReactNode } from 'react';
import { ThemeProvider } from '@emotion/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { theme } from '../src/styles/theme';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
export function renderUI(node: ReactNode) { return renderToStaticMarkup(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ThemeProvider theme={theme}>{node}</ThemeProvider></QueryClientProvider>); }
