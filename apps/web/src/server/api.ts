import 'server-only';
import { demoStatusSchema, cardSearchResponseSchema, cardVariantSchema, valuationSchema, marketPricesResponseSchema } from '@tcg/contracts';
import type { CatalogItem } from '../lib/formatters';

export class CoreApiError extends Error {
  constructor(public readonly status: number) { super(`Core API 요청 실패 (${status})`); }
}
async function get(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, process.env.CORE_API_URL ?? 'http://127.0.0.1:4000'), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  if (!response.ok) throw new CoreApiError(response.status);
  return response.json();
}
export async function getCardVariant(id: string) { return cardVariantSchema.parse(await get(`/api/cards/${encodeURIComponent(id)}`)); }
export async function searchCards(query: string) { return cardSearchResponseSchema.parse(await get(`/api/cards?${new URLSearchParams({ q: query, limit: '20' })}`)); }
export async function getValuation(id: string) { return valuationSchema.parse(await get(`/api/cards/${encodeURIComponent(id)}/valuation`)); }
export async function getMarketPrices(id: string) { return marketPricesResponseSchema.parse(await get(`/api/cards/${encodeURIComponent(id)}/prices`)); }

/** 보조 가격 요청의 실패를 카드 검색 실패와 구분하고 동시 조회 카드를 4개로 제한한다. */
export async function getCatalog(query: string): Promise<CatalogItem[]> {
  const { items } = await searchCards(query);
  const results: CatalogItem[] = new Array(items.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const index = next++; const card = items[index]!;
      if(card.catalogRole==='REFERENCE'){results[index]={card,valuation:null,prices:null,valuationFailed:false,pricesFailed:false};continue;}
      const [valuation, prices] = await Promise.allSettled([getValuation(card.id), getMarketPrices(card.id)]);
      results[index] = { card, valuation: valuation.status === 'fulfilled' ? valuation.value : null, prices: prices.status === 'fulfilled' ? prices.value : null, valuationFailed: valuation.status === 'rejected', pricesFailed: prices.status === 'rejected' };
    }
  }));
  // 조회된 범위 안에서 실제 이미지가 있는 카드를 우선 진열한다. 전체 정렬 API는 아니다.
  return results.sort((a, b) => Number(b.card.language === 'KO')-Number(a.card.language === 'KO') || Number(Boolean(b.card.imageUrl)) - Number(Boolean(a.card.imageUrl)));
}

export async function getDemoStatus() { return demoStatusSchema.parse(await get('/api/demo')); }
