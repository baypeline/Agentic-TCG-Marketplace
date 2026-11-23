import type { CardVariant } from './index.js';

// PokéAPI 버전 고정 종명 출처. 카드 자체의 실제 판본을 보증하는 자료는 아니다.
const demoNameSourceUrl = 'https://raw.githubusercontent.com/PokeAPI/pokeapi/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv';

// 고정 ID의 시연용 데이터. 실제 카드 카탈로그·시장가격이 아니다.
export const demoCards: readonly CardVariant[] = [
  { id: '00000000-0000-4000-8000-000000000001', game: 'POKEMON', name: 'Pikachu', setCode: 'SV', cardNumber: '025', language: 'EN', edition: 'NORMAL', condition: 'NM', localizedNames: [{ locale: 'ko', name: '피카츄', source: 'POKEAPI_SPECIES', sourceUrl: demoNameSourceUrl }] },
  { id: '00000000-0000-4000-8000-000000000002', game: 'POKEMON', name: 'Charizard', setCode: 'SV', cardNumber: '006', language: 'EN', edition: 'HOLO', condition: 'NM', localizedNames: [{ locale: 'ko', name: '리자몽', source: 'POKEAPI_SPECIES', sourceUrl: demoNameSourceUrl }] },
  { id: '00000000-0000-4000-8000-000000000003', game: 'POKEMON', name: 'Eevee', setCode: 'SV', cardNumber: '133', language: 'KO', edition: 'NORMAL', condition: 'NM', localizedNames: [{ locale: 'ko', name: '이브이', source: 'POKEAPI_SPECIES', sourceUrl: demoNameSourceUrl }] },
];
export const demoPriceSource = '시연용 합성 가격. 실제 시장가격이 아닙니다.';
export const demoPriceObservations = [
  ['00000000-0000-4000-8000-000000000001', '10000000'],
  ['00000000-0000-4000-8000-000000000001', '12000000'],
  ['00000000-0000-4000-8000-000000000001', '14000000'],
  ['00000000-0000-4000-8000-000000000002', '25000000'],
  ['00000000-0000-4000-8000-000000000002', '30000000'],
  ['00000000-0000-4000-8000-000000000002', '35000000'],
].map(([cardVariantId, amount], index) => ({
  id: `00000000-0000-4000-8001-${String(index + 1).padStart(12, '0')}`,
  cardVariantId: cardVariantId!,
  amount: amount!,
  dataSource: 'MOCK' as const,
  source: demoPriceSource,
  observedAt: '2026-11-19T00:00:00.000Z',
}));
