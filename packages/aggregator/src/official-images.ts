import { load } from 'cheerio';
import { createHash } from 'node:crypto';
import { officialImageEntrySchema,type OfficialImageEntry } from '@tcg/db';
export type OfficialImageTarget=Pick<OfficialImageEntry,'cardVariantId'|'name'|'setCode'|'cardNumber'|'officialCardId'>;
const base='https://pokemoncard.co.kr';
export function parseOfficialImage(html:string,target:OfficialImageTarget){
 const $=load(html),image=$('img.feature_image'),name=$('.detail_wrap .header .card-hp.title').first().text().trim();
 const printed=$('.pre_info_wrap .p_num').clone().children().remove().end().text().trim();
 const product=$('a.search_href').map((_,e)=>$(e).text().trim()).get().filter(Boolean);
 const normalize=(v:string)=>v.normalize('NFKC').replace(/\s+/g,' ').trim();
 const products:Record<string,string>={SV5K:'스칼렛&바이올렛 확장팩 「와일드포스」',SV4K:'스칼렛&바이올렛 확장팩 「고대의 포효」',SV4M:'스칼렛&바이올렛 확장팩 「미래의 일섬」'};
 if(image.length!==1||normalize(name)!==normalize(target.name)||!printed.startsWith(target.cardNumber+'/')||product.length!==1)throw new Error('공식 카드의 이미지·이름·인쇄 번호·제품 정보를 확인하지 못했습니다.');
 if(!products[target.setCode]||normalize(product[0]!)!==normalize(products[target.setCode]!))throw new Error('공식 수록 제품이 일치하지 않습니다.');
 const imageUrl=new URL(image.attr('src')??'',base).href;
 return {...target,provider:'POKEMON_KOREA' as const,printedNumber:printed,productName:product[0]!,sourceUrl:`${base}/cards/detail/${target.officialCardId}`,imageUrl};
}
export function createOfficialImageSource(options:{fetch?:typeof fetch;now?:()=>Date}={}){
 const request=options.fetch??fetch;
 async function get(url:string){const r=await request(url,{redirect:'error',signal:AbortSignal.timeout(10000)});if(!r.ok)throw new Error('공식 카드 요청 실패');return r;}
 return {async collect(target:OfficialImageTarget):Promise<OfficialImageEntry>{
  if(!/^[A-Z0-9]+$/.test(target.officialCardId))throw new Error('공식 카드 ID 형식 오류');
  const response=await get(`${base}/cards/detail/${target.officialCardId}`);
  const info=parseOfficialImage(await response.text(),target);
  // Validate the host/path before requesting the image, even when HTML is compromised.
  officialImageEntrySchema.parse({...info,contentSha256:'0'.repeat(64),byteLength:100,verifiedAt:new Date().toISOString()});
  const image=await get(info.imageUrl);
  if(image.headers.get('content-type')?.split(';')[0]!=='image/webp'||Number(image.headers.get('content-length')??0)>2_000_000)throw new Error('공식 이미지 응답 형식 오류');
  const bytes=new Uint8Array(await image.arrayBuffer());
  if(bytes.length>2_000_000||Buffer.from(bytes.slice(0,4)).toString()!=='RIFF'||Buffer.from(bytes.slice(8,12)).toString()!=='WEBP')throw new Error('WebP 이미지 본문 오류');
  return officialImageEntrySchema.parse({...info,contentSha256:createHash('sha256').update(bytes).digest('hex'),byteLength:bytes.length,verifiedAt:(options.now?.()??new Date()).toISOString()});
 }};
}
