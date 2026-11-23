import { afterEach, expect, it, vi } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
vi.mock('server-only', () => ({}));
import { getCatalog } from '../src/server/api';

afterEach(() => vi.unstubAllGlobals());
it('보조 가격 API 일부가 실패해도 카드 목록과 정상 가격을 유지한다', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: URL) => {
    const path = url.pathname;
    if (path === '/api/cards') return Response.json({ items: demoCards.slice(0, 2), nextCursor: null });
    const id = path.split('/')[3]!;
    if (path.endsWith('/prices')) return new Response('', { status: 503 });
    if (id === demoCards[0]!.id) throw new Error('price timeout');
    return Response.json({ cardVariantId: id, currency: 'USDC', dataSource: 'MOCK', status: 'AVAILABLE', estimatedPrice: '12000000', sampleSize: 1, confidence: 'LOW', evaluatedAt: '2026-11-22T00:00:00Z', sourceSummary: ['mock'] });
  }));
  const rows = await getCatalog('피카츄');
  expect(rows).toHaveLength(2);
  expect(rows.find(row => row.card.id === demoCards[0]!.id)).toMatchObject({ valuationFailed: true, valuation: null, pricesFailed: true });
  expect(rows.find(row => row.card.id === demoCards[1]!.id)).toMatchObject({ valuationFailed: false, valuation: { estimatedPrice: '12000000' }, pricesFailed: true });
});
it('카드 검색 자체의 실패는 빈 목록 성공으로 바꾸지 않는다', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 500 })));
  await expect(getCatalog('피카츄')).rejects.toMatchObject({ status: 500 });
});
