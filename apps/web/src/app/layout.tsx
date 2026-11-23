import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import localFont from 'next/font/local';
import { Providers } from './providers';
import { AppShell } from '../components/app-shell';

const pretendard = localFont({ src: '../assets/fonts/PretendardVariable.woff2', variable: '--font-pretendard', display: 'swap', weight: '100 900' });

export const metadata: Metadata = { title: { default: 'Agentic TCG', template: '%s | Agentic TCG' }, description: '원하는 카드와 예산, 거래 조건을 정하고 AI 에이전트에게 거래를 맡기는 TCG 플랫폼입니다.' };
export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="ko" className={pretendard.variable}><body><Providers><AppShell>{children}</AppShell></Providers></body></html>;
}
