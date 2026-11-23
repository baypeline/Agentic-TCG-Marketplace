import { expect, it } from 'vitest';
import { createInMemoryCardIdentityStore, createTcgdexSetSource } from '../src/index.js';

function source(set: unknown) {
  const calls: string[] = [];
  const service = createTcgdexSetSource({ identityStore: createInMemoryCardIdentityStore(), fetch: async url => {
    const path = new URL(String(url)).pathname; calls.push(path);
    if (path.endsWith('/sets/base1')) return Response.json(set);
    if (path.endsWith('/series/tcgp')) return Response.json({ id: 'tcgp', sets: [] });
    return Response.json({ id: 'base1-1', name: 'Pikachu', localId: '1', set: { id: 'base1' }, image: 'https://assets.tcgdex.net/en/base/base1/1' });
  } });
  return { service, calls };
}
const set = { id: 'base1', name: 'Base Set', serie: { id: 'base' }, cards: [{ id: 'base1-2' }, { id: 'base1-1' }] };
it('KO 세트는 제공된 카드 목록만 계획에 넣고 선언된 전체 수록 수를 추측해 채우지 않는다', async () => {
  const calls: string[] = [];
  const ko = createTcgdexSetSource({ language: 'ko', identityStore: createInMemoryCardIdentityStore(), fetch: async input => {
    const path = new URL(String(input)).pathname; calls.push(path);
    if (path.endsWith('/sets/SV5K')) return Response.json({ id: 'SV5K', name: '와일드포스', serie: { id: 'SV' }, cardCount: { total: 71 }, cards: [{ id: 'SV5K-001' }] });
    if (path === '/v2/en/series/tcgp') return Response.json({ id: 'tcgp', sets: [] });
    return Response.json({ id: 'SV5K-001', name: '로젤리아', localId: '001', set: { id: 'SV5K' } });
  } });
  expect(await ko.getSet('SV5K')).toEqual({ setId: 'SV5K', setName: '와일드포스', externalIds: ['SV5K-001'] });
  expect(await ko.getCard('SV5K-001', 'SV5K')).toMatchObject({ language: 'KO', name: '로젤리아' });
  expect(calls).toContain('/v2/ko/sets/SV5K');
});
it('세트의 카드 목록을 고정 순서로 만들고 상세의 실제 이미지와 내부 UUID를 유지한다', async () => {
  const { service } = source(set);
  expect(await service.getSet('base1')).toEqual({ setId: 'base1', setName: 'Base Set', externalIds: ['base1-1', 'base1-2'] });
  const first = await service.getCard('base1-1', 'base1');
  const second = await service.getCard('base1-1', 'base1');
  expect(second.id).toBe(first.id);
  expect(first).toMatchObject({ imageUrl: 'https://assets.tcgdex.net/en/base/base1/1/high.webp', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' });
});
it('Pocket·다른 세트·중복 ID·빈 세트는 수집 계획으로 허용하지 않는다', async () => {
  for (const data of [{ ...set, serie: { id: 'tcgp' } }, { ...set, id: 'base2' }, { ...set, cards: [{ id: 'base1-1' }, { id: 'base1-1' }] }, { ...set, cards: [] }]) await expect(source(data).service.getSet('base1')).rejects.toMatchObject({ reason: 'INVALID_RESPONSE' });
  await expect(source(set).service.getCard('base1-1', 'base2')).rejects.toMatchObject({ reason: 'INVALID_RESPONSE' });
});
it('세트 ID의 필터 삽입과 과대 응답을 거부한다', async () => {
  const s = source(set); await expect(s.service.getSet('base1|base2')).rejects.toThrow();
  expect(s.calls).toEqual([]);
  const large = createTcgdexSetSource({ identityStore: createInMemoryCardIdentityStore(), fetch: async () => new Response(' '.repeat(2_000_001)) });
  await expect(large.getSet('base1')).rejects.toMatchObject({ reason: 'INVALID_RESPONSE' });
});
it('호출 제한·외부 오류·시간 초과는 자료 부재로 숨기지 않는다', async () => {
  for (const [status, reason] of [[429, 'RATE_LIMITED'], [404, 'HTTP_ERROR'], [500, 'HTTP_ERROR']] as const) {
    const s = createTcgdexSetSource({ identityStore: createInMemoryCardIdentityStore(), fetch: async () => new Response('', { status }) });
    await expect(s.getSet('base1')).rejects.toMatchObject({ reason });
  }
  const timeout = createTcgdexSetSource({ identityStore: createInMemoryCardIdentityStore(), requestTimeoutMs: 5, fetch: async (_, init) => new Promise((_, reject) => { init!.signal!.addEventListener('abort', () => reject(new Error('timeout')), { once: true }); }) });
  await expect(timeout.getSet('base1')).rejects.toMatchObject({ reason: 'TIMEOUT' });
});
