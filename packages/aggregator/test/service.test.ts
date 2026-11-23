import { expect, it } from 'vitest';
import { createAggregatorService, createMockCardAdapter } from '../src/index.js';

const service = createAggregatorService({ adapter: createMockCardAdapter() });
it('검색어와 limit를 적용한다', async () => {
  expect((await service.searchCards({ query: 'PIKA', limit: 1 })).map(card => card.name)).toEqual(['Pikachu']);
  expect(await service.searchCards({ query: 'unknown', limit: 10 })).toEqual([]);
});
it('존재하지 않는 카드는 null을 반환한다', async () => {
  expect(await service.getCardVariant('00000000-0000-4000-8000-000000000099')).toBeNull();
});
it('Mock 데모에서도 한국어 종명으로 검색할 수 있다', async () => {
  expect((await service.searchCards({ query: '피카', limit: 10 })).map(card => card.name)).toEqual(['Pikachu']);
});
it('반환된 한국어 표기를 수정해도 다음 조회 결과는 보존된다', async () => {
  const [card] = await service.searchCards({ query: '피카츄', limit: 1 });
  card!.localizedNames![0]!.name = '변경된 이름';
  expect((await service.getCardVariant(card!.id))?.localizedNames?.[0]?.name).toBe('피카츄');
});
