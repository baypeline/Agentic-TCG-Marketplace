'use client';

import { QueryClient } from '@tanstack/react-query';

let browserQueryClient: QueryClient | undefined;

export function getQueryClient() {
  // SSR 요청 간 캐시를 공유하지 않고, 브라우저에서는 재렌더·Suspense에도 유지한다.
  if (typeof window === 'undefined') return new QueryClient();
  return browserQueryClient ??= new QueryClient();
}
