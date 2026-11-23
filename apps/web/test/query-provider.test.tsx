import { afterEach, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { useQueryClient } from '@tanstack/react-query';
import { Providers } from '../src/app/providers';
import { getQueryClient } from '../src/lib/query-client';

vi.mock('next/navigation', () => ({ useServerInsertedHTML: () => {} }));
afterEach(() => vi.unstubAllGlobals());

it('공통 Providers의 하위 컴포넌트에 QueryClient를 제공하고 서버 캐시를 분리한다', () => {
  function Probe() {
    const client = useQueryClient();
    expect(client.getQueryData(['private-example'])).toBeUndefined();
    client.setQueryData(['private-example'], 'request-only');
    return <span>Query Provider 연결 확인</span>;
  }
  for (let request = 0; request < 2; request++) {
    expect(renderToStaticMarkup(<Providers><Probe /></Providers>)).toContain('Query Provider 연결 확인');
  }
});

it('브라우저에서는 같은 QueryClient와 캐시를 재사용한다', () => {
  vi.stubGlobal('window', {});
  const first = getQueryClient();
  first.setQueryData(['example'], 'cached');
  const second = getQueryClient();
  expect(second).toBe(first);
  expect(second.getQueryData(['example'])).toBe('cached');
  first.clear();
});
