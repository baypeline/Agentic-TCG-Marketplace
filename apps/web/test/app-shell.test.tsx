import { expect, it, vi } from 'vitest';
import { renderUI } from './render';
import { AppShell } from '../src/components/app-shell';

const route = vi.hoisted(() => ({ pathname: '/' }));
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname, useRouter: () => ({ refresh: vi.fn() }) }));

it('랜딩에는 서비스 탭을 표시하지 않고 마켓 진입과 닫힌 에이전트를 제공한다', () => {
  route.pathname = '/';
  const html = renderUI(<AppShell>랜딩 콘텐츠</AppShell>);
  expect(html).not.toContain('aria-label="서비스 메뉴"');
  expect(html).toContain('href="/cards"');
  expect(html).toContain('data-chat-open="false"');
  expect(html).toContain('aria-expanded="false"');
  expect(html).toContain('inert="" aria-hidden="true"');
  expect(html).toContain('랜딩 콘텐츠');
});

it('서비스 화면에는 현재 위치를 구분하는 탐색 메뉴를 제공한다', () => {
  route.pathname = '/collection';
  const html = renderUI(<AppShell>보유 카드</AppShell>);
  expect(html).toContain('aria-label="서비스 메뉴"');
  expect(html).toMatch(/href="\/collection"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/collection"/);
  expect(html).toContain('href="/marketplace"');
});
