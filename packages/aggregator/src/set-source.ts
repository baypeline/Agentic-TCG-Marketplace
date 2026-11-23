import { z } from 'zod';
import type { CardVariant } from '@tcg/contracts';
import { createTcgdexCardAdapter, TcgdexAdapterError, type TcgdexCardAdapterOptions } from './tcgdex.js';

export const externalSetIdSchema = z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/);
export const setPlanSchema = z.object({ setId: externalSetIdSchema, setName: z.string().trim().min(1), externalIds: z.array(externalSetIdSchema).min(1).max(2000) }).refine(value => new Set(value.externalIds).size === value.externalIds.length);
export type SetPlan = z.infer<typeof setPlanSchema>;
export interface SetCardSource {
  getSet(setId: string): Promise<SetPlan>;
  getCard(externalId: string, setId: string): Promise<CardVariant>;
}
export function createTcgdexSetSource(options: TcgdexCardAdapterOptions): SetCardSource {
  const adapter = createTcgdexCardAdapter(options);
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = z.number().int().min(1).max(60_000).parse(options.requestTimeoutMs ?? 5000);
  return {
    async getSet(input) {
      const setId = externalSetIdSchema.parse(input);
      const signal = AbortSignal.timeout(timeoutMs);
      try {
        const response = await fetcher(`https://api.tcgdex.net/v2/${options.language ?? 'en'}/sets/${encodeURIComponent(setId)}`, { signal, redirect: 'error', headers: { accept: 'application/json' } });
        if (!response.ok) {
          await response.body?.cancel();
          throw new TcgdexAdapterError(response.status === 429 ? 'RATE_LIMITED' : 'HTTP_ERROR', response.status === 429 ? 503 : 502, response.status === 429 || response.status >= 500);
        }
        const reader = response.body?.getReader();
        if (!reader) throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
        const chunks: Uint8Array[] = []; let size = 0;
        while (true) {
          const { done, value } = await reader.read(); if (done) break;
          size += value.length;
          if (size > 2_000_000) { await reader.cancel(); throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false); }
          chunks.push(value);
        }
        const bytes = new Uint8Array(size); let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
        const data = z.object({ id: externalSetIdSchema, name: z.string().trim().min(1), serie: z.object({ id: externalSetIdSchema }), cards: z.array(z.object({ id: externalSetIdSchema })).min(1).max(2000) }).parse(JSON.parse(new TextDecoder().decode(bytes)));
        if (signal.aborted) throw new TcgdexAdapterError('TIMEOUT', 504, true);
        if (data.id !== setId || data.serie.id === 'tcgp') throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
        const externalIds = data.cards.map(card => card.id).sort();
        return setPlanSchema.parse({ setId, setName: data.name, externalIds });
      } catch (error) {
        if (error instanceof TcgdexAdapterError) throw error;
        if (signal.aborted) throw new TcgdexAdapterError('TIMEOUT', 504, true);
        if (error instanceof z.ZodError || error instanceof SyntaxError) throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
        throw new TcgdexAdapterError('NETWORK_ERROR', 502, true);
      }
    },
    async getCard(externalId, setId) {
      const card = await adapter.getCardByExternalId(externalSetIdSchema.parse(externalId));
      if (!card || card.setCode !== setId) throw new TcgdexAdapterError('INVALID_RESPONSE', 502, false);
      return card;
    },
  };
}
