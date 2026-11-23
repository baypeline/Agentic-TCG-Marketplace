import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { cardVariantSchema } from '@tcg/contracts';
import { createAggregatorService, createInMemoryCardIdentityStore, createTcgdexCardAdapter, TcgdexAdapterError, type CardIdentityStore } from '../src/index.js';

const card = { id: 'base1-58', localId: '58', name: 'Pikachu', set: { id: 'base1' }, image: 'https://assets.tcgdex.net/en/base/base1/58', pricing: { market: 100 }, variants: { normal: true, firstEdition: true } };
const reference = { provider: 'TCGDEX', externalId: card.id, language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' } as const;
const json = (value: unknown, status = 200) => Response.json(value, { status });

function fixtureFetch(details = [card]) {
  return vi.fn<typeof globalThis.fetch>(async input => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/series/tcgp')) return json({ id: 'tcgp', sets: [{ id: 'A1' }] });
    if (url.pathname.endsWith('/cards')) return json(details.map(detail => ({ id: detail.id, name: detail.name, localId: detail.localId })));
    const detail = details.find(item => url.pathname.endsWith('/cards/' + item.id));
    return detail ? json(detail) : json({ error: 'missing' }, 404);
  });
}

describe('TCGdex 외부 카드 어댑터', () => {
  it('KO 원문·식별자를 보존하고 같은 외부 ID의 EN 카드와 UUID를 분리한다', async () => {
    const identityStore = createInMemoryCardIdentityStore();
    const calls: string[] = [];
    const fetcher: typeof fetch = async input => {
      const url = new URL(String(input)); calls.push(url.pathname);
      if (url.pathname === '/v2/en/series/tcgp') return json({ id: 'tcgp', sets: [] });
      if (url.pathname.includes('/series/')) return json({}, 404);
      const detail = { ...card, id: 'SV4K-001', localId: '001', name: url.pathname.includes('/ko/') ? '야나프' : 'Pansage', set: { id: 'SV4K' }, image: undefined };
      return json(url.pathname.endsWith('/cards') ? [detail] : detail);
    };
    const ko = createTcgdexCardAdapter({ language: 'ko', identityStore, fetch: fetcher });
    const en = createTcgdexCardAdapter({ language: 'en', identityStore, fetch: fetcher });
    const [korean] = await ko.searchCards({ query: '야나프', limit: 1 });
    const english = await en.getCardByExternalId('SV4K-001');
    expect(korean).toMatchObject({ name: '야나프', language: 'KO', setCode: 'SV4K', cardNumber: '001', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' });
    expect(korean!.imageUrl).toBeUndefined(); expect(korean).not.toHaveProperty('pricing');
    expect(korean!.id).not.toBe(english!.id);
    expect(await ko.getCardVariant(korean!.id)).toEqual(korean);
    const before = calls.length;
    expect(await ko.getCardVariant(english!.id)).toBeNull(); expect(calls).toHaveLength(before);
    expect(calls).toContain('/v2/ko/cards'); expect(calls).not.toContain('/v2/ko/series/tcgp');
  });
  it('상세 응답을 UUID 기반 공통 DTO로 정규화하고 상태·에디션을 추측하지 않는다', async () => {
    const fetcher = fixtureFetch();
    const service = createAggregatorService({ adapter: createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() }) });
    const results = await service.searchCards({ query: 'Pikachu', limit: 1 });
    expect(results).toHaveLength(1);
    const normalized = cardVariantSchema.parse(results[0]);
    expect(normalized).toEqual({ id: expect.any(String), game: 'POKEMON', name: 'Pikachu', setCode: 'base1', cardNumber: '58', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED', imageUrl: card.image + '/high.webp' });
    expect(normalized.id).not.toBe(card.id);
    expect(normalized).not.toHaveProperty('pricing');
    const url = new URL(String(fetcher.mock.calls[0]![0]));
    expect(url.origin).toBe('https://api.tcgdex.net');
    expect(url.searchParams.get('name')).toBe('like:Pikachu');
    expect(url.searchParams.get('pagination:itemsPerPage')).toBe('1');
    expect(url.searchParams.get('pagination:page')).toBe('1');
  });

  it('같은 매핑 저장소로 재조회·어댑터 재생성 시 UUID가 유지된다', async () => {
    const identityStore = createInMemoryCardIdentityStore();
    const fetcher = fixtureFetch();
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore });
    const [first] = await adapter.searchCards({ query: 'Pikachu', limit: 1 });
    const [second] = await adapter.searchCards({ query: 'Pikachu', limit: 1 });
    expect(second?.id).toBe(first!.id);
    expect(await adapter.getCardVariant(first!.id)).toEqual(first);
    expect(fetcher).toHaveBeenCalledTimes(4); // 검색 2회, 상세와 Pocket 메타데이터 각 1회
    const restarted = createTcgdexCardAdapter({ fetch: fetcher, identityStore });
    expect((await restarted.getCardVariant(first!.id))?.id).toBe(first!.id);
  });

  it('모르는 UUID는 외부 호출 없이 null을 반환한다', async () => {
    const fetcher = fixtureFetch();
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    expect(await adapter.getCardVariant(randomUUID())).toBeNull();
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('이미지 부재와 숫자 카드 번호를 처리한다', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async input => String(input).includes('/series/') ? json({ id: 'tcgp', sets: [] }) : String(input).includes('/cards?') ? json([{ id: card.id, name: card.name, localId: 58 }]) : json({ ...card, image: undefined, localId: 58 }));
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    const [result] = await adapter.searchCards({ query: '', limit: 1 });
    expect(result?.cardNumber).toBe('58');
    expect(result?.imageUrl).toBeUndefined();
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.has('name')).toBe(false);
  });

  it('검색어의 URL 특수문자는 별도 쿼리로 해석되지 않는다', async () => {
    const fetcher = fixtureFetch([]);
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    expect(await adapter.searchCards({ query: 'Pika & limit=99?#+', limit: 1 })).toEqual([]);
    expect(new URL(String(fetcher.mock.calls[0]![0])).searchParams.get('name')).toBe('like:Pika & limit=99?#+');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each(['eq:Pikachu', 'Pika*', 'Pikachu|Charizard'])('공급자 필터 표현식을 일반 검색어로 실행하지 않는다: %s', async query => {
    const fetcher = fixtureFetch();
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    await expect(adapter.searchCards({ query, limit: 1 })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', statusCode: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('검색 중 삭제된 카드의 404는 제외하고, 상세 404는 null을 반환한다', async () => {
    const identityStore = createInMemoryCardIdentityStore();
    const id = await identityStore.getOrCreateId(reference);
    const fetcher = vi.fn<typeof globalThis.fetch>(async input => String(input).includes('/cards?') ? json([{ id: card.id, localId: '58', name: 'Pikachu' }]) : json({}, 404));
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore });
    expect(await adapter.searchCards({ query: 'Pikachu', limit: 1 })).toEqual([]);
    expect(await adapter.getCardVariant(id)).toBeNull();
  });

  it('Pocket 시리즈는 실물 TCG 카탈로그에 포함하지 않는다', async () => {
    const identityStore = createInMemoryCardIdentityStore();
    const pocket = { ...card, id: 'A1-1', set: { id: 'A1' } };
    const adapter = createTcgdexCardAdapter({ fetch: fixtureFetch([pocket]), identityStore });
    expect(await adapter.searchCards({ query: 'Pikachu', limit: 1 })).toEqual([]);
    const id = await identityStore.getOrCreateId({ ...reference, externalId: pocket.id });
    expect(await adapter.getCardVariant(id)).toBeNull();
  });

  it.each([429, 500, 401, 404])('HTTP %s 오류를 빈 검색 결과나 Mock 성공으로 숨기지 않는다', async status => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => json({ sensitive: 'upstream body' }, status));
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    await expect(adapter.searchCards({ query: 'Pikachu', limit: 1 })).rejects.toMatchObject({ reason: status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', statusCode: status === 429 ? 503 : 502, retryable: status === 429 || status >= 500 });
    expect(fetcher).toHaveBeenCalledTimes(1); // 자동 재시도 없음
  });

  it('429의 Retry-After를 재시도 정보로 보존한다', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => new Response('', { status: 429, headers: { 'retry-after': '3' } }));
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    await expect(adapter.searchCards({ query: 'Pikachu', limit: 1 })).rejects.toMatchObject({ reason: 'RATE_LIMITED', retryAfterMs: 3000 });
  });

  it('잘못된 JSON은 제공자 오류로 처리한다', async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () => new Response('{broken'));
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    await expect(adapter.searchCards({ query: '', limit: 1 })).rejects.toMatchObject({ reason: 'INVALID_RESPONSE', statusCode: 502 });
  });

  it.each([null, { ...card, id: 'other-1' }, { ...card, set: undefined }, { ...card, image: 'http://unsafe.test/image' }])('잘못된 상세를 카드 없음으로 처리하지 않는다', async payload => {
    const identityStore = createInMemoryCardIdentityStore();
    const id = await identityStore.getOrCreateId(reference);
    const adapter = createTcgdexCardAdapter({ fetch: vi.fn<typeof globalThis.fetch>(async () => json(payload)), identityStore });
    await expect(adapter.getCardVariant(id)).rejects.toMatchObject({ reason: 'INVALID_RESPONSE', statusCode: 502 });
  });

  it('네트워크 오류 원문은 사용자 오류에 노출하지 않는다', async () => {
    const adapter = createTcgdexCardAdapter({ fetch: vi.fn<typeof globalThis.fetch>(async () => { throw new Error('private diagnostic'); }), identityStore: createInMemoryCardIdentityStore() });
    try { await adapter.searchCards({ query: '', limit: 1 }); throw new Error('Expected failure'); }
    catch (error) {
      expect(error).toBeInstanceOf(TcgdexAdapterError);
      expect(error).toMatchObject({ reason: 'NETWORK_ERROR', statusCode: 502, retryable: true });
      expect((error as Error).message).not.toContain('private diagnostic');
    }
  });

  it.each([{ requestTimeoutMs: 10, operationTimeoutMs: 100 }, { requestTimeoutMs: 100, operationTimeoutMs: 10 }])('요청 또는 전체 HTTP 조회의 제한 시간에 중단한다', async timeouts => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async (_input, init) => new Promise((_resolve, reject) => {
      init!.signal!.addEventListener('abort', () => reject(init!.signal!.reason), { once: true });
    }));
    const adapter = createTcgdexCardAdapter({ ...timeouts, fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    await expect(adapter.searchCards({ query: '', limit: 1 })).rejects.toMatchObject({ reason: 'TIMEOUT', statusCode: 504, retryable: true });
  });

  it('상세 캐시가 만료되면 최신 데이터를 다시 조회한다', async () => {
    let clock = 0;
    const fetcher = fixtureFetch();
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore(), now: () => clock, cacheTtlMs: 100 });
    const [result] = await adapter.searchCards({ query: '', limit: 1 });
    expect(fetcher).toHaveBeenCalledTimes(3);
    await adapter.getCardVariant(result!.id);
    expect(fetcher).toHaveBeenCalledTimes(3);
    clock = 101;
    await adapter.getCardVariant(result!.id);
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it('상세 보충 호출은 최대 두 건씩 수행하고 검색 순서를 유지한다', async () => {
    let active = 0;
    let peak = 0;
    const details = Array.from({ length: 4 }, (_, index) => ({ ...card, id: `base1-${index + 1}`, localId: String(index + 1) }));
    const baseFetch = fixtureFetch(details);
    const fetcher = vi.fn<typeof globalThis.fetch>(async (input, init) => {
      if (new URL(String(input)).pathname.includes('/cards/')) {
        active++; peak = Math.max(peak, active);
        await new Promise(resolve => setTimeout(resolve, 5));
        try { return await baseFetch(input, init); } finally { active--; }
      }
      return baseFetch(input, init);
    });
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    expect((await adapter.searchCards({ query: '', limit: 4 })).map(result => result.cardNumber)).toEqual(['1', '2', '3', '4']);
    expect(peak).toBe(2);
  });

  it('공급자 검색 결과가 limit보다 많아도 후속 호출 수를 제한한다', async () => {
    const fetcher = fixtureFetch([card, { ...card, id: 'base1-59', localId: '59' }]);
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createInMemoryCardIdentityStore() });
    expect(await adapter.searchCards({ query: '', limit: 1 })).toHaveLength(1);
    expect(fetcher.mock.calls.filter(call => new URL(String(call[0])).pathname.includes('/cards/'))).toHaveLength(1);
  });

  it('잘못된 UUID 매핑을 공통 DTO로 공개하지 않는다', async () => {
    const identityStore: CardIdentityStore = { async getOrCreateId() { return 'external-id'; }, async findById() { return null; } };
    const adapter = createTcgdexCardAdapter({ fetch: fixtureFetch(), identityStore });
    await expect(adapter.searchCards({ query: '', limit: 1 })).rejects.toMatchObject({ code: 'INTERNAL_ERROR', statusCode: 500 });
  });
});
