import { expect, it, vi } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import type { CardVariant } from '@tcg/contracts';
import { createCardCollectionService, type CardDataAdapter, type CardCatalogWriter } from '../src/index.js';

function setup(cards: CardVariant[]) {
  const source: CardDataAdapter = { searchCards: vi.fn(async () => cards), getCardVariant: vi.fn(async () => null) };
  const saveCards = vi.fn<CardCatalogWriter['saveCards']>(async input => [...input.cards]);
  const service = createCardCollectionService({ source, writer: { saveCards }, now: () => new Date('2026-11-22T00:00:00Z') });
  return { source, saveCards, service };
}

it('카드 수집 결과와 완료 시각을 저장소에 전달한다', async () => {
  const { service, source, saveCards } = setup([{ ...demoCards[0]! }]);
  const result = await service.collectCards({ query: ' Pikachu ', limit: 5 });
  expect(source.searchCards).toHaveBeenCalledWith({ query: 'Pikachu', limit: 5 });
  expect(saveCards).toHaveBeenCalledWith({ cards: [demoCards[0]], collectedAt: '2026-11-22T00:00:00.000Z' });
  expect(result).toMatchObject({ storedCount: 1, collectedAt: '2026-11-22T00:00:00.000Z' });
});

it('외부 조회가 실패하면 저장하지 않고 원래 오류를 전달한다', async () => {
  const { service, source, saveCards } = setup([]);
  const error = new Error('upstream failure');
  vi.mocked(source.searchCards).mockRejectedValue(error);
  await expect(service.collectCards({ query: 'Pikachu', limit: 5 })).rejects.toBe(error);
  expect(saveCards).not.toHaveBeenCalled();
});

it('잘못된 카드가 섞인 배치는 저장을 시작하지 않는다', async () => {
  const { service, saveCards } = setup([{ ...demoCards[0]!, name: '' }]);
  await expect(service.collectCards({ query: '', limit: 5 })).rejects.toMatchObject({ reason: 'INVALID_CARD' });
  expect(saveCards).not.toHaveBeenCalled();
});

it('같은 UUID가 중복된 배치는 저장하지 않는다', async () => {
  const { service, saveCards } = setup([{ ...demoCards[0]! }, { ...demoCards[0]! }]);
  await expect(service.collectCards({ query: '', limit: 5 })).rejects.toMatchObject({ reason: 'DUPLICATE_CARD' });
  expect(saveCards).not.toHaveBeenCalled();
});

it('요청한 limit를 넘는 응답을 추가 저장하지 않는다', async () => {
  const { service, saveCards } = setup(demoCards.map(card => ({ ...card })));
  await expect(service.collectCards({ query: '', limit: 1 })).rejects.toMatchObject({ reason: 'INVALID_CARD' });
  expect(saveCards).not.toHaveBeenCalled();
});

it('검색 결과가 없으면 빈 결과를 반환하고 쓰기를 생략한다', async () => {
  const { service, saveCards } = setup([]);
  expect(await service.collectCards({ query: 'unknown', limit: 5 })).toMatchObject({ items: [], storedCount: 0 });
  expect(saveCards).not.toHaveBeenCalled();
});
