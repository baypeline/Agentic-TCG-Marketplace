import { expect, it, vi } from 'vitest';
import { createPokeApiNameProvider, pokeApiNamesSourceUrl } from '../src/index.js';

const languages = 'id,identifier\n3,ko\n9,en\n1,ja\n';
const names = 'pokemon_species_id,local_language_id,name,genus\n25,9,Pikachu,Mouse\n25,3,피카츄,쥐\n6,9,Charizard,Flame\n6,3,리자몽,화염\n';
function fixtureFetch(nameCsv = names, languageCsv = languages) {
  return vi.fn<typeof globalThis.fetch>(async input => new Response(String(input).endsWith('/languages.csv') ? languageCsv : nameCsv));
}
it('검증된 언어 코드로 한국어·영어 종명을 연결하고 출처를 보존한다', async () => {
  const fetcher = fixtureFetch();
  const result = await createPokeApiNameProvider({ fetch: fetcher }).loadNames();
  expect(result).toEqual([
    { speciesId: 6, englishName: 'Charizard', koreanName: '리자몽', sourceUrl: pokeApiNamesSourceUrl },
    { speciesId: 25, englishName: 'Pikachu', koreanName: '피카츄', sourceUrl: pokeApiNamesSourceUrl },
  ]);
  expect(fetcher).toHaveBeenCalledTimes(2);
});
it('언어 테이블의 숫자 ID가 바뀌어도 identifier로 대응한다', async () => {
  const provider = createPokeApiNameProvider({ fetch: fixtureFetch('pokemon_species_id,local_language_id,name,genus\n25,7,Pikachu,Mouse\n25,8,피카츄,쥐\n', 'id,identifier\n7,en\n8,ko\n') });
  expect((await provider.loadNames())[0]?.koreanName).toBe('피카츄');
});
it('인용부호·쉼표가 있는 CSV 이름을 훼손하지 않는다', async () => {
  const provider = createPokeApiNameProvider({ fetch: fixtureFetch('pokemon_species_id,local_language_id,name,genus\n999,9,"Test, Form",Other\n999,3,테스트,기타\n') });
  expect((await provider.loadNames())[0]?.englishName).toBe('Test, Form');
});
it('한쪽 언어가 없는 종명을 임의 번역하지 않는다', async () => {
  const provider = createPokeApiNameProvider({ fetch: fixtureFetch(names + '1000,9,Unknown,Other\n') });
  expect(await provider.loadNames()).toHaveLength(2);
});
it.each([
  'invalid,header\n1,2\n',
  names + '25,3,다른이름,기타\n',
  names + '999,9,PIKACHU,Other\n999,3,중복,기타\n',
  'pokemon_species_id,local_language_id,name,genus\n25,9,Pikachu,Mouse\n',
])('잘못되거나 중복·모호한 원본은 가져오지 않는다', async csv => {
  await expect(createPokeApiNameProvider({ fetch: fixtureFetch(csv) }).loadNames()).rejects.toMatchObject({ reason: 'INVALID_DATA' });
});
it('누락된 한국어 언어 정의를 거부한다', async () => {
  await expect(createPokeApiNameProvider({ fetch: fixtureFetch(names, 'id,identifier\n9,en\n') }).loadNames()).rejects.toMatchObject({ reason: 'INVALID_DATA' });
});
it('네트워크 오류 원문을 노출하지 않는다', async () => {
  const provider = createPokeApiNameProvider({ fetch: vi.fn<typeof globalThis.fetch>(async () => { throw new Error('private upstream diagnostic'); }) });
  await expect(provider.loadNames()).rejects.toMatchObject({ reason: 'SOURCE_UNAVAILABLE' });
});
