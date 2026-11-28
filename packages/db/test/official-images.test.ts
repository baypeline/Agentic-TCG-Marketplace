import { expect,it } from 'vitest';
import { readCatalogFixtures,readOfficialImages,officialImagesSchema } from '../src/index.js';
it('한국어판 20장의 공식 매핑은 기존 UUID·이름·세트·카드 번호와 일치한다',async()=>{
 const [cards,images]=await Promise.all([readCatalogFixtures(),readOfficialImages()]);
 expect(images.entries).toHaveLength(20);
 for(const entry of images.entries){const card=cards.cards.find(c=>c.id===entry.cardVariantId);expect(card).toMatchObject({language:'KO',name:entry.name,setCode:entry.setCode,cardNumber:entry.cardNumber});expect(entry.imageUrl).toContain(`/SV5K/SV5K_${entry.cardNumber}.webp`);expect(entry.byteLength).toBeGreaterThan(100);}
});
it('외부 URL·잘못된 인쇄 번호·중복 매핑은 seed 입력 검증에서 거부한다',async()=>{
 const pack=await readOfficialImages();
 for(const entry of [{...pack.entries[0]!,sourceUrl:'https://attacker.test/card'},{...pack.entries[0]!,printedNumber:'999/071'},{...pack.entries[0]!,imageUrl:pack.entries[1]!.imageUrl}])expect(()=>officialImagesSchema.parse({version:1,entries:[entry]})).toThrow();
 expect(()=>officialImagesSchema.parse({...pack,entries:[pack.entries[0],pack.entries[0]]})).toThrow();
});
