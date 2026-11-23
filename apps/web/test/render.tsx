import type { ReactNode } from 'react';
import { ThemeProvider } from '@emotion/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { theme } from '../src/styles/theme';
export function renderUI(node: ReactNode) { return renderToStaticMarkup(<ThemeProvider theme={theme}>{node}</ThemeProvider>); }
