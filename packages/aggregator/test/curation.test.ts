import { expect,it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { selectCuratedCards,type CatalogCandidate } from '../src/index.js';
const time=new Date('2026-11-28T00:00:00Z');
const base:CatalogCandidate={card:{...demoCards[0]!,imageUrl:'https://example.test/card.webp'},prices:[{amount:'10',observedAt:new Date('2026-11-27T00:00:00Z')}],hasInventory:true};
const options={priceSource:'mock' as const,maxCards:12,now:()=>time};
it('이미지·필수 판본 정보·양수 가격이 없는 카드는 선별에서 제외한다',()=>{
 const bad=[{...base,card:{...base.card,imageUrl:undefined}},{...base,card:{...base.card,edition:'UNSPECIFIED'}},{...base,card:{...base.card,condition:'UNSPECIFIED'}},{...base,card:{...base.card,name:' '}},{...base,prices:[]},{...base,prices:[{amount:'0',observedAt:time}]}];
 expect(selectCuratedCards([...bad,base],options)).toEqual([base.card]);
});
it('한국어 표시 이름이 있는 영어판보다 실제 한국어판을 먼저 선별한다',()=>{
 const ko={...base,hasInventory:false,card:{...base.card,id:'00000000-0000-4000-8000-000000000099',language:'KO',name:'피카츄'}};
 expect(selectCuratedCards([base,ko],{...options,maxCards:1})).toEqual([ko.card]);
});
it('추천 카드 순서를 개수 제한보다 먼저 적용하고 추천 밖의 기존 카드도 이름으로 찾는다',()=>{
 const old={...base,card:{...base.card,name:'팬텀 ex',language:'KO'}};
 const cute={...base,card:{...base.card,id:'00000000-0000-4000-8000-000000000098',name:'치라미',language:'KO'}};
 const selection={...options,maxCards:1,preferredCardIds:[cute.card.id]};
 expect(selectCuratedCards([old,cute],selection)).toEqual([cute.card]);
 expect(selectCuratedCards([old,cute],{...selection,query:'팬텀'})).toEqual([old.card]);
});
it('미래 가격과 오래된 시장 가격을 제외하되 고정 Mock 가격은 만료시키지 않는다',()=>{
 const old={...base,prices:[{amount:'12',observedAt:new Date('2026-11-19T00:00:00Z')}]};
 expect(selectCuratedCards([old],options)).toEqual([base.card]);expect(selectCuratedCards([old],{...options,priceSource:'market'})).toEqual([]);
 expect(selectCuratedCards([{...base,prices:[{amount:'12',observedAt:new Date(time.getTime()+1)}]}],options)).toEqual([]);
});
it('공식 이미지만 있는 원본과 거래용 카드가 함께 있으면 거래용 카드를 우선하고 기존 카드 검색을 보존한다',()=>{
 const imageSource={provider:'POKEMON_KOREA' as const,officialCardId:'BS2024004001',sourceUrl:'https://pokemoncard.co.kr/cards/detail/BS2024004001',productName:'와일드포스',printedNumber:'001/071',verifiedAt:time.toISOString()};
 const reference={...base,card:{...base.card,id:'00000000-0000-4000-8000-000000000097',name:'로젤리아',setCode:'SV5K',cardNumber:'001',language:'KO',catalogRole:'REFERENCE' as const,imageSource,edition:'UNSPECIFIED',condition:'UNSPECIFIED'},prices:[],hasInventory:false};
 const trading={...reference,card:{...reference.card,id:'00000000-0000-4000-8000-000000000098',catalogRole:undefined,edition:'NORMAL',condition:'NM'},prices:base.prices,hasInventory:true};
 expect(selectCuratedCards([reference],options)).toEqual([reference.card]);
 expect(selectCuratedCards([reference,trading],options)).toEqual([trading.card]);
 expect(selectCuratedCards([reference,trading,base],{...options,maxCards:1,query:'Pikachu'})).toEqual([base.card]);
});
