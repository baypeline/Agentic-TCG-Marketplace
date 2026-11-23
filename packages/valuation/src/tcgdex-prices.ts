import { AppError } from '@tcg/contracts';
import { z } from 'zod';
import { snapshotInputSchema, type MarketPriceProvider, type SnapshotInput } from './market-types.js';

export class MarketPriceError extends AppError {
  constructor(public readonly reason: 'TIMEOUT' | 'RATE_LIMITED' | 'SOURCE_ERROR' | 'INVALID_DATA' | 'SNAPSHOT_CONFLICT', retryable = false) {
    super('INTERNAL_ERROR', `외부 가격 처리 실패: ${reason}`, reason === 'TIMEOUT' ? 504 : reason === 'RATE_LIMITED' ? 503 : 502, retryable);
  }
}
const object = z.record(z.string(), z.unknown());
const externalIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export function createTcgdexPriceProvider(options: { fetch?: typeof globalThis.fetch; timeoutMs?: number; now?: () => Date } = {}): MarketPriceProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeout = z.number().int().min(1).max(60_000).parse(options.timeoutMs ?? 5000);
  const now = options.now ?? (() => new Date());
  return { async getPrices(input) {
    const externalId = externalIdSchema.parse(input);
    const sourceUrl = `https://api.tcgdex.net/v2/en/cards/${encodeURIComponent(externalId)}`;
    const signal = AbortSignal.timeout(timeout);
    try {
      const response = await fetcher(sourceUrl, { headers: { accept: 'application/json' }, redirect: 'error', signal });
      if (!response.ok) {
        await response.body?.cancel();
        throw new MarketPriceError(response.status === 429 ? 'RATE_LIMITED' : 'SOURCE_ERROR', response.status === 429 || response.status >= 500);
      }
      // 응답 본문에도 timeout과 크기 제한을 적용한다.
      const reader = response.body?.getReader();
      if (!reader) throw new MarketPriceError('INVALID_DATA');
      let size = 0; const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > 1_000_000) { await reader.cancel(); throw new MarketPriceError('INVALID_DATA'); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(size); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      if (signal.aborted) throw new MarketPriceError('TIMEOUT', true);
      const card = object.parse(JSON.parse(new TextDecoder().decode(bytes)));
      if (card.id !== externalId) throw new MarketPriceError('INVALID_DATA');
      if (card.pricing == null) return [];
      const pricing = object.parse(card.pricing);
      const result: SnapshotInput[] = [];
      function add(provider: 'CARDMARKET' | 'TCGPLAYER', variant: string, type: SnapshotInput['priceType'], value: unknown, currency: 'EUR' | 'USD', observedAt: string) {
        if (value == null || value === 0) return;
        const amount = z.number().finite().positive().parse(value);
        const parsed = snapshotInputSchema.parse({ provider, externalId, providerVariant: variant, priceType: type, originalCurrency: currency, originalAmount: String(amount), sourceUrl, observedAt });
        result.push(parsed);
      }
      for (const [key, provider, currency] of [['cardmarket', 'CARDMARKET', 'EUR'], ['tcgplayer', 'TCGPLAYER', 'USD']] as const) {
        if (pricing[key] == null) continue;
        const data = object.parse(pricing[key]);
        if (data.unit !== currency || typeof data.updated !== 'string') throw new MarketPriceError('INVALID_DATA');
        const observedAt = z.iso.datetime().parse(data.updated);
        if (Date.parse(observedAt) > now().getTime()) throw new MarketPriceError('INVALID_DATA');
        if (key === 'cardmarket') {
          for (const [variant, suffix] of [['normal', ''], ['holo', '-holo']]) {
            for (const [metric, type] of [['low', 'ASKING_LOW'], ['avg', 'PROVIDER_AVERAGE'], ['trend', 'PROVIDER_TREND']] as const) add(provider, variant!, type, data[metric + suffix], currency, observedAt);
          }
        } else {
          // 명시된 provider variant만 지원하며 알 수 없는 변형은 추측하지 않는다.
          for (const variant of ['normal', 'holofoil', 'reverse-holofoil', '1st-edition', '1st-edition-holofoil', 'unlimited', 'unlimited-holofoil']) {
            if (data[variant] == null) continue;
            const price = object.parse(data[variant]);
            add(provider, variant, 'PROVIDER_MARKET', price.marketPrice, currency, observedAt);
            add(provider, variant, 'ASKING_LOW', price.lowPrice, currency, observedAt);
          }
        }
      }
      return result;
    } catch (error) {
      if (error instanceof MarketPriceError) throw error;
      if (signal.aborted) throw new MarketPriceError('TIMEOUT', true);
      if (error instanceof z.ZodError || error instanceof SyntaxError) throw new MarketPriceError('INVALID_DATA');
      throw new MarketPriceError('SOURCE_ERROR', true);
    }
  } };
}
