import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createInMemoryCardIdentityStore } from '../src/index.js';

const reference = { provider: 'TCGDEX', externalId: 'base1-58', language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' } as const;

it('언어·에디션·상태 표기를 정규화하고 외부 ID 대소문자는 보존한다', async () => {
  const store = createInMemoryCardIdentityStore();
  const id = await store.getOrCreateId(reference);
  expect(await store.getOrCreateId({ ...reference, language: ' en ', edition: ' unspecified ', condition: ' unspecified ' })).toBe(id);
  expect(await store.getOrCreateId({ ...reference, externalId: 'BASE1-58' })).not.toBe(id);
  expect(await store.findById(id)).toEqual(reference);
  expect(await store.findById(id.toUpperCase())).toEqual(reference);
});

it('역조회 결과를 수정해도 저장된 매핑은 바뀌지 않는다', async () => {
  const store = createInMemoryCardIdentityStore();
  const id = await store.getOrCreateId(reference);
  const result = await store.findById(id);
  result!.edition = 'HOLO';
  expect(await store.findById(id)).toEqual(reference);
  expect(await store.findById('invalid-id')).toBeNull();
  expect(await store.findById(randomUUID())).toBeNull();
});

it('빈 상태나 경로 형식의 외부 ID를 저장하지 않는다', async () => {
  const store = createInMemoryCardIdentityStore();
  await expect(store.getOrCreateId({ ...reference, condition: ' ' })).rejects.toThrow();
  await expect(store.getOrCreateId({ ...reference, externalId: '../base1-58' })).rejects.toThrow();
});
