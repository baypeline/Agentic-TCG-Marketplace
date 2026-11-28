import { expect,it,vi } from 'vitest';
import { createOfficialImageSource,parseOfficialImage } from '../src/official-images.js';
const target={cardVariantId:'00000000-0000-4000-8000-000000000001',officialCardId:'BS2024004001',name:'로젤리아',setCode:'SV5K',cardNumber:'001'};
const html=`<img class="feature_image" src="/public-assets/home/data/cards.image_www/data/wmimages/SV/SV5K/SV5K_001.webp?w=512"><div class="pre_info_wrap"><span class="p_num">001/071<span>C</span></span></div><div class="detail_wrap"><div class="header"><span class="card-hp title">로젤리아</span></div></div><a class="search_href">스칼렛&amp;바이올렛 확장팩 「와일드포스」</a>`;
const image=new Uint8Array(100);image.set(new TextEncoder().encode('RIFF'),0);image.set(new TextEncoder().encode('WEBP'),8);
it('공식 페이지의 대표 이미지·카드 이름·제품·인쇄 번호를 검증하고 이미지 본문 해시를 보존한다',async()=>{
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(html)).mockResolvedValueOnce(new Response(image,{headers:{'content-type':'image/webp'}}));
 const result=await createOfficialImageSource({fetch:request,now:()=>new Date('2026-11-28T00:00:00Z')}).collect(target);
 expect(result).toMatchObject({cardVariantId:target.cardVariantId,printedNumber:'001/071',byteLength:100,verifiedAt:'2026-11-28T00:00:00.000Z'});expect(result.contentSha256).toMatch(/^[a-f0-9]{64}$/);expect(request).toHaveBeenCalledTimes(2);expect(request.mock.calls[0]![1]).toMatchObject({redirect:'error'});
});
it('이름·카드 번호·제품이 다르거나 대표 이미지가 중복되면 연결하지 않는다',()=>{
 for(const changed of [html.replaceAll('로젤리아','팬텀 ex'),html.replace('001/071','002/071'),html.replace('와일드포스','미래의 일섬'),html+'<img class="feature_image" src="x">'])expect(()=>parseOfficialImage(changed,target)).toThrow();
});
it('HTML의 외부 이미지 URL과 다른 카드 경로는 두 번째 요청 전에 거부한다',async()=>{
 for(const changed of [html.replace('/public-assets/','https://attacker.test/public-assets/'),html.replace('SV5K_001.webp','SV5K_002.webp')]){
  const request=vi.fn<typeof fetch>().mockResolvedValue(new Response(changed));await expect(createOfficialImageSource({fetch:request}).collect(target)).rejects.toThrow();expect(request).toHaveBeenCalledTimes(1);
 }
});
it('이미지가 아닌 응답과 잘못된 공식 ID는 거부한다',async()=>{
 const request=vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(html)).mockResolvedValueOnce(new Response('not an image',{headers:{'content-type':'image/webp'}}));
 await expect(createOfficialImageSource({fetch:request}).collect(target)).rejects.toThrow();
 const noRequest=vi.fn<typeof fetch>();await expect(createOfficialImageSource({fetch:noRequest}).collect({...target,officialCardId:'../private'})).rejects.toThrow();expect(noRequest).not.toHaveBeenCalled();
});
