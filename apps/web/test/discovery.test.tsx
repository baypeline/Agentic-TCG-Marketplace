import { afterEach, expect, it, vi } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { sameNameCards } from '../src/lib/discovery';
import { LandingView } from '../src/features/landing/landing-view';
import { renderUI } from './render';
vi.mock('server-only', () => ({}));
import { getDiscovery } from '../src/server/discovery';

afterEach(() => vi.unstubAllGlobals());
const pikachu = demoCards[0]!;

it('연관 카드는 부분 일치 이름과 현재 카드 및 중복 UUID를 제외한다', () => {
  const other = { ...pikachu, id: '00000000-0000-4000-8000-000000000099', setCode: 'base2' };
  const rows = sameNameCards([pikachu, { ...other, name: 'Flying Pikachu' }, other, other], 'Pikachu', pikachu.id);
  expect(rows.map(card => card.id)).toEqual([other.id]);
});

it('주제 검색 일부와 참고 시세가 실패해도 성공한 카드와 탐색 링크를 유지한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    if (url.pathname.endsWith('/prices')) return new Response('', { status: 503 });
    const query = url.searchParams.get('q');
    if (query === 'Flareon') return new Response('', { status: 503 });
    return Response.json({ items: query === 'Pikachu' ? [pikachu] : query === 'Eevee' ? [demoCards[2]] : [], nextCursor: null });
  }));
  const data = await getDiscovery();
  expect(data.spotlight[0]).toMatchObject({ card: { id: pikachu.id }, prices: null, pricesFailed: true });
  expect(data.family).toHaveLength(1);
  expect(data.familyFailed).toBe(true);
  const html = renderUI(<LandingView discovery={data} />);
  expect(html).toContain('일부 카드 정보를 불러오지 못했어요');
  expect(html).toContain(`/cards/${pikachu.id}`);
  expect(html).toContain('href="/cards"');
  expect(html).toContain('href="/agent"');
  expect(html).toContain('href="/collection#owned-cards"');
  expect(html).toContain('설명용 예시');
  expect(html).toContain('AI 에이전트에게');
});

it('주제 검색 실패를 카드가 없는 성공 응답과 구분한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
  const data = await getDiscovery();
  expect(data).toMatchObject({ spotlight: [], family: [], spotlightFailed: true, familyFailed: true });
  const html = renderUI(<LandingView discovery={data} />);
  expect(html).toContain('일부 카드 정보를 불러오지 못했어요.');
  expect(html).not.toContain('아직 보여드릴 카드가 없어요.');
  expect(html).toContain('구매 조건 정하기');
});
