import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { AppError } from '@tcg/contracts';

export const pokeApiNameRevision = 'cd5f6c6232f23430aa6089896d96230f5f7ecef4';
const dataBase = `https://raw.githubusercontent.com/PokeAPI/pokeapi/${pokeApiNameRevision}/data/v2/csv/`;
export const pokeApiNamesSourceUrl = dataBase + 'pokemon_species_names.csv';
export const pokemonNameTranslationSchema = z.object({
  speciesId: z.number().int().positive(),
  englishName: z.string().trim().min(1).max(200),
  koreanName: z.string().trim().min(1).max(200).regex(/[가-힣]/u),
  sourceUrl: z.url({ protocol: /^https$/ }),
});
export type PokemonNameTranslation = z.infer<typeof pokemonNameTranslationSchema>;
export interface PokemonNameProvider { loadNames(): Promise<PokemonNameTranslation[]> }
export function normalizePokemonNameKey(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
export class PokemonNameImportError extends AppError {
  constructor(public readonly reason: 'SOURCE_UNAVAILABLE' | 'SOURCE_TIMEOUT' | 'INVALID_DATA') {
    super('INTERNAL_ERROR', reason === 'INVALID_DATA' ? '한국어 이름 원본 데이터가 올바르지 않습니다.' : '한국어 이름 원본을 가져오지 못했습니다.', reason === 'SOURCE_TIMEOUT' ? 504 : 502, reason !== 'INVALID_DATA');
  }
}

export function validatePokemonNames(input: PokemonNameTranslation[]): PokemonNameTranslation[] {
  const result = z.array(pokemonNameTranslationSchema).min(1).max(2000).safeParse(input);
  if (!result.success || new Set(result.data.map(row => row.speciesId)).size !== result.data.length || new Set(result.data.map(row => normalizePokemonNameKey(row.englishName))).size !== result.data.length) {
    throw new PokemonNameImportError('INVALID_DATA');
  }
  return result.data;
}

export function createPokeApiNameProvider(options: { fetch?: typeof globalThis.fetch; timeoutMs?: number } = {}): PokemonNameProvider {
  const fetcher = options.fetch ?? globalThis.fetch;
  const timeoutMs = z.number().int().min(1).max(60_000).parse(options.timeoutMs ?? 10_000);
  async function csv(path: string): Promise<unknown[]> {
    const signal = AbortSignal.timeout(timeoutMs);
    let text: string;
    try {
      const response = await fetcher(dataBase + path, { signal, redirect: 'error' });
      if (!response.ok) { await response.body?.cancel(); throw new PokemonNameImportError('SOURCE_UNAVAILABLE'); }
      text = await response.text();
    } catch (error) {
      if (error instanceof PokemonNameImportError) throw error;
      throw new PokemonNameImportError(signal.aborted ? 'SOURCE_TIMEOUT' : 'SOURCE_UNAVAILABLE');
    }
    if (Buffer.byteLength(text, 'utf8') > 2_000_000) throw new PokemonNameImportError('INVALID_DATA');
    try { return parse(text, { bom: true, columns: true, skip_empty_lines: true, max_record_size: 10_000 }) as unknown[]; }
    catch { throw new PokemonNameImportError('INVALID_DATA'); }
  }
  return {
    async loadNames() {
      const [languageData, nameData] = await Promise.all([csv('languages.csv'), csv('pokemon_species_names.csv')]);
      const languages = z.array(z.object({ id: z.coerce.number().int().positive(), identifier: z.string() })).safeParse(languageData);
      const names = z.array(z.object({ pokemon_species_id: z.coerce.number().int().positive(), local_language_id: z.coerce.number().int().positive(), name: z.string().trim().min(1) })).max(50_000).safeParse(nameData);
      if (!languages.success || !names.success) throw new PokemonNameImportError('INVALID_DATA');
      const en = languages.data.filter(row => row.identifier === 'en');
      const ko = languages.data.filter(row => row.identifier === 'ko');
      if (en.length !== 1 || ko.length !== 1) throw new PokemonNameImportError('INVALID_DATA');
      const pairs = new Map<number, { englishName?: string; koreanName?: string }>();
      for (const row of names.data) {
        const key = row.local_language_id === en[0]!.id ? 'englishName' : row.local_language_id === ko[0]!.id ? 'koreanName' : null;
        if (!key) continue;
        const pair = pairs.get(row.pokemon_species_id) ?? {};
        if (pair[key] !== undefined) throw new PokemonNameImportError('INVALID_DATA');
        pair[key] = row.name;
        pairs.set(row.pokemon_species_id, pair);
      }
      return validatePokemonNames([...pairs].flatMap(([speciesId, pair]) => pair.englishName && pair.koreanName ? [{ speciesId, englishName: pair.englishName, koreanName: pair.koreanName, sourceUrl: pokeApiNamesSourceUrl }] : []).sort((a, b) => a.speciesId - b.speciesId));
    },
  };
}
