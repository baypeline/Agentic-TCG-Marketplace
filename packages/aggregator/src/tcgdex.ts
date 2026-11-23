import { z } from 'zod';
import { AppError, cardSearchQuerySchema, cardVariantSchema, idSchema, type CardVariant } from '@tcg/contracts';
import type { CardDataAdapter } from './index.js';
import type { CardIdentityStore } from './card-identity.js';

const externalIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
const textSchema = z.string().trim().min(1);
const localIdSchema = z.union([textSchema, z.number().int().nonnegative()]).transform(String);
const imageSchema = z.url({ protocol: /^https$/ }).optional();
const briefSchema = z.object({ id: externalIdSchema, localId: localIdSchema, name: textSchema, image: imageSchema });
const detailSchema = briefSchema.extend({ set: z.object({ id: textSchema }) });
type CardDetail = z.infer<typeof detailSchema>;
export type TcgdexFailure = 'TIMEOUT' | 'RATE_LIMITED' | 'NETWORK_ERROR' | 'HTTP_ERROR' | 'INVALID_RESPONSE';

export class TcgdexAdapterError extends AppError {
  constructor(public readonly reason: TcgdexFailure, statusCode: number, retryable: boolean, public readonly retryAfterMs?: number) {
    super('INTERNAL_ERROR', {
      TIMEOUT: '외부 카드 API 응답 시간이 초과되었습니다.',
      RATE_LIMITED: '외부 카드 API 호출 한도에 도달했습니다.',
      NETWORK_ERROR: '외부 카드 API에 연결할 수 없습니다.',
      HTTP_ERROR: '외부 카드 API가 요청을 처리하지 못했습니다.',
      INVALID_RESPONSE: '외부 카드 API 응답 형식이 올바르지 않습니다.',
    }[reason], statusCode, retryable);
  }
}

export type TcgdexLanguage = 'en' | 'ko';

export interface TcgdexCardAdapterOptions {
  identityStore: CardIdentityStore;
  /** 공급자의 언어별 카탈로그. 한국어 이름 번역으로 영어판을 한국어판으로 바꾸지 않는다. */
  language?: TcgdexLanguage;
  fetch?: typeof globalThis.fetch;
  requestTimeoutMs?: number;
  operationTimeoutMs?: number;
  cacheTtlMs?: number;
  now?: () => number;
}
export interface TcgdexCardAdapter extends CardDataAdapter {
  getCardByExternalId(externalId: string): Promise<CardVariant | null>;
}

const unspecified = 'UNSPECIFIED';
const notFound = Symbol('TCGDEX_NOT_FOUND');

export function createTcgdexCardAdapter(options: TcgdexCardAdapterOptions): TcgdexCardAdapter {
  const language = z.enum(['en', 'ko']).parse(options.language ?? 'en');
  const cardLanguage = language.toUpperCase();
  const fetcher = options.fetch ?? globalThis.fetch;
  const requestTimeoutMs = z.number().int().min(1).max(60_000).parse(options.requestTimeoutMs ?? 5_000);
  const operationTimeoutMs = z.number().int().min(1).max(120_000).parse(options.operationTimeoutMs ?? 15_000);
  const cacheTtlMs = z.number().int().min(0).max(3_600_000).parse(options.cacheTtlMs ?? 60_000);
  const now = options.now ?? Date.now;
  const cache = new Map<string, { card: CardDetail; expiresAt: number }>();
  let pocketSets: { ids: Set<string>; expiresAt: number } | undefined;

  async function request(path: string, signal: AbortSignal, allowNotFound = false, requestLanguage = language): Promise<unknown | null> {
    const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(requestTimeoutMs)]);
    let response: Response;
    try {
      response = await fetcher(new URL(`https://api.tcgdex.net/v2/${requestLanguage}/${path}`), {
        headers: { accept: 'application/json' }, signal: requestSignal, redirect: 'error',
      });
    } catch {
      throw new TcgdexAdapterError(requestSignal.aborted ? 'TIMEOUT' : 'NETWORK_ERROR', requestSignal.aborted ? 504 : 502, true);
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      if (allowNotFound && response.status === 404) return notFound;
      if (response.status === 429) {
        const value = response.headers.get('retry-after');
        const seconds = value !== null && /^\d+$/.test(value) ? Number(value) : undefined;
        const date = value === null ? NaN : Date.parse(value);
        const delay = seconds !== undefined ? seconds * 1_000 : Number.isFinite(date) ? Math.max(0, date - now()) : undefined;
        throw new TcgdexAdapterError('RATE_LIMITED', 503, true, delay !== undefined && Number.isFinite(delay) ? delay : undefined);
      }
      throw new TcgdexAdapterError('HTTP_ERROR', 502, response.status >= 500 || response.status === 408);
    }
    try { return await response.json(); }
    catch { throw new TcgdexAdapterError(requestSignal.aborted ? 'TIMEOUT' : 'INVALID_RESPONSE', requestSignal.aborted ? 504 : 502, requestSignal.aborted); }
  }

  async function getDetail(externalId: string, signal: AbortSignal): Promise<CardDetail | null> {
    if (signal.aborted) throw new TcgdexAdapterError('TIMEOUT', 504, true);
    const cached = cache.get(externalId);
    if (cached && cached.expiresAt > now()) return cached.card;
    cache.delete(externalId);
    const data = await request(`cards/${encodeURIComponent(externalId)}`, signal, true);
    if (data === notFound) return null;
    const result = detailSchema.safeParse(data);
    if (!result.success || result.data.id !== externalId) throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
    if (cacheTtlMs > 0) {
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(externalId, { card: result.data, expiresAt: now() + cacheTtlMs });
    }
    return result.data;
  }

  async function getPocketSets(signal: AbortSignal): Promise<Set<string>> {
    if (pocketSets && pocketSets.expiresAt > now()) return pocketSets.ids;
    // KO에는 tcgp 메타데이터가 없어도 실물 카드가 존재한다. 제외 ID는 공통 EN 시리즈에서 읽는다.
    const result = z.object({ id: z.literal('tcgp'), sets: z.array(z.object({ id: textSchema })) }).safeParse(await request('series/tcgp', signal, false, 'en'));
    if (!result.success) throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
    const ids = new Set(result.data.sets.map(set => set.id));
    pocketSets = { ids, expiresAt: now() + cacheTtlMs };
    return ids;
  }

  async function normalize(card: CardDetail): Promise<CardVariant> {
    const id = await options.identityStore.getOrCreateId({ provider: 'TCGDEX', externalId: card.id, language: cardLanguage, edition: unspecified, condition: unspecified });
    if (!idSchema.safeParse(id).success) throw new AppError('INTERNAL_ERROR', '카드 ID 매핑 저장소가 올바른 UUID를 반환하지 않았습니다.', 500);
    return cardVariantSchema.parse({
      id, game: 'POKEMON', name: card.name, setCode: card.set.id, cardNumber: card.localId,
      language: cardLanguage, edition: unspecified, condition: unspecified,
      imageUrl: card.image ? `${card.image}/high.webp` : undefined,
    });
  }

  return {
    async getCardByExternalId(input) {
      const externalId = externalIdSchema.parse(input);
      const signal = AbortSignal.timeout(operationTimeoutMs);
      const card = await getDetail(externalId, signal);
      if (!card || (await getPocketSets(signal)).has(card.set.id)) return null;
      return normalize(card);
    },
    async searchCards(input) {
      const { q, limit } = cardSearchQuerySchema.parse({ q: input.query, limit: input.limit });
      // 공급자 필터 연산자(|, *, :)가 일반 검색어로부터 실행되는 것을 막는다.
      if (/[|*:]/.test(q)) throw new AppError('VALIDATION_ERROR', '외부 카드 검색어에는 |, *, : 문자를 사용할 수 없습니다.', 400);
      const controller = new AbortController();
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(operationTimeoutMs)]);
      try {
        const params = new URLSearchParams({ 'pagination:page': '1', 'pagination:itemsPerPage': String(limit), 'sort:field': 'id', 'sort:order': 'ASC' });
        if (q) params.set('name', `like:${q}`);
        const result = z.array(briefSchema).max(100).safeParse(await request(`cards?${params}`, signal));
        if (!result.success) throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
        const ids = [...new Set(result.data.map(card => card.id))].slice(0, limit);
        const details: (CardDetail | null)[] = new Array(ids.length).fill(null);
        let next = 0;
        // 검색 brief에 set 정보가 없으므로 상세를 보충하되 동시에 최대 2건만 호출한다.
        await Promise.all(Array.from({ length: Math.min(2, ids.length) }, async () => {
          while (next < ids.length) {
            const index = next++;
            details[index] = await getDetail(ids[index]!, signal);
          }
        }));
        const cards = details.filter((card): card is CardDetail => card !== null);
        if (!cards.length) return [];
        const excludedSets = await getPocketSets(signal);
        return await Promise.all(cards.filter(card => !excludedSets.has(card.set.id)).map(normalize));
      } finally { controller.abort(); }
    },
    async getCardVariant(id) {
      const internalId = idSchema.parse(id).toLowerCase();
      const reference = await options.identityStore.findById(internalId);
      if (!reference || reference.provider !== 'TCGDEX' || reference.language !== cardLanguage || reference.edition !== unspecified || reference.condition !== unspecified) return null;
      if (!externalIdSchema.safeParse(reference.externalId).success) throw new AppError('INTERNAL_ERROR', '카드 ID 매핑의 외부 식별자가 올바르지 않습니다.', 500);
      const signal = AbortSignal.timeout(operationTimeoutMs);
      const card = await getDetail(reference.externalId, signal);
      if (!card) return null;
      if ((await getPocketSets(signal)).has(card.set.id)) return null;
      const normalized = await normalize(card);
      if (normalized.id.toLowerCase() !== internalId) throw new AppError('INTERNAL_ERROR', '카드 ID 매핑이 일치하지 않습니다.', 500);
      return normalized;
    },
  };
}
