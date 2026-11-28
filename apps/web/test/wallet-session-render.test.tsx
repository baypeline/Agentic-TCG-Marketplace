import { expect, it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { useWalletSession } from '../src/features/auth/use-wallet-session';
import { walletQueryKey } from '../src/features/auth/wallet-client';

function SessionProbe() { const session = useWalletSession(); return <p>{session.isPending ? '로그인 확인 중' : session.data?.user ? '로그인됨' : '로그인 필요'}</p>; }
it('미리 조회된 로그인 결과가 있어도 서버 첫 화면은 동일하게 렌더한다', () => {
  const render = (data?: unknown) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    if (data) client.setQueryData(walletQueryKey, data);
    return renderToStaticMarkup(<QueryClientProvider client={client}><SessionProbe /></QueryClientProvider>);
  };
  expect(render()).toBe('<p>로그인 확인 중</p>');
  expect(render({ user: null })).toBe(render());
  expect(render({ user: { userId: '00000000-0000-4000-8000-000000000001', address: `0x${'1'.repeat(40)}` } })).toBe(render());
});
