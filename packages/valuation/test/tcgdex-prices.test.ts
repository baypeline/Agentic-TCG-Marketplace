import { expect, it } from 'vitest';
import { createTcgdexPriceProvider } from '../src/index.js';

const now = () => new Date('2026-11-22T12:00:00Z');
const updated = '2026-11-22T00:00:00Z';
function provider(pricing: unknown, id = 'swsh3-136') {
  return createTcgdexPriceProvider({ now, fetch: async () => Response.json({ id, pricing }) });
}
it('EUR 집계 가격과 USD 변형별 가격을 분리하고 실제 체결가로 표시하지 않는다', async () => {
  const rows = await provider({ cardmarket: { updated, unit: 'EUR', low: 0.02, avg: 0.08, trend: 0.14, 'avg-holo': 0.31 }, tcgplayer: { updated, unit: 'USD', normal: { lowPrice: 0.02, marketPrice: 0.26 }, 'reverse-holofoil': { marketPrice: 0.4 } } }).getPrices('swsh3-136');
  expect(rows).toHaveLength(7);
  expect(rows[1]).toMatchObject({ provider: 'CARDMARKET', originalCurrency: 'EUR', originalAmount: '0.08', priceType: 'PROVIDER_AVERAGE', providerVariant: 'normal' });
  expect(rows.at(-1)).toMatchObject({ provider: 'TCGPLAYER', originalCurrency: 'USD', originalAmount: '0.4', providerVariant: 'reverse-holofoil' });
});
it('가격 부재·null·0은 임의 가격으로 대체하지 않는다', async () => {
  for (const pricing of [null, undefined, {}, { cardmarket: null, tcgplayer: null }, { cardmarket: { updated, unit: 'EUR', low: 0, avg: null } }]) expect(await provider(pricing).getPrices('swsh3-136')).toEqual([]);
});
it('요청 카드와 다른 ID를 거부한다', async () => {
  await expect(provider({}, 'wrong').getPrices('swsh3-136')).rejects.toMatchObject({ reason: 'INVALID_DATA' });
});
it('틀린 통화·관측 시각·음수·잘못된 자료형을 거부한다', async () => {
  for (const data of [{ unit: 'USD', avg: 1 }, { updated: 'invalid', avg: 1 }, { updated: '2026-12-01T00:00:00Z', avg: 1 }, { avg: -1 }, { avg: '0.8' }, { avg: 0.1234567 }]) {
    await expect(provider({ cardmarket: { updated, unit: 'EUR', ...data } }).getPrices('swsh3-136')).rejects.toMatchObject({ reason: 'INVALID_DATA' });
  }
});
it('외부 오류와 호출 제한을 빈 가격 목록으로 숨기지 않는다', async () => {
  for (const [status, reason] of [[429, 'RATE_LIMITED'], [404, 'SOURCE_ERROR'], [500, 'SOURCE_ERROR']] as const) {
    const service = createTcgdexPriceProvider({ fetch: async () => new Response('', { status }) });
    await expect(service.getPrices('swsh3-136')).rejects.toMatchObject({ reason });
  }
});
it('네트워크 원문을 노출하지 않고 시간 초과를 구분한다', async () => {
  await expect(createTcgdexPriceProvider({ fetch: async () => { throw new Error('secret'); } }).getPrices('swsh3-136')).rejects.toThrow('SOURCE_ERROR');
  const timeout = createTcgdexPriceProvider({ timeoutMs: 5, fetch: async (_, init) => new Promise((_, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }) });
  await expect(timeout.getPrices('swsh3-136')).rejects.toMatchObject({ reason: 'TIMEOUT', retryable: true });
});
it('잘못된 JSON과 과도한 응답 크기를 거부한다', async () => {
  for (const body of ['{bad', ' '.repeat(1_000_001)]) await expect(createTcgdexPriceProvider({ fetch: async () => new Response(body) }).getPrices('swsh3-136')).rejects.toMatchObject({ reason: 'INVALID_DATA' });
});
