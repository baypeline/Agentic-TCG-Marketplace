import type { CardVariant, MarketPricesResponse } from '@tcg/contracts';

export interface DiscoveryItem { card: CardVariant; prices: MarketPricesResponse | null; pricesFailed: boolean }
export interface DiscoveryData { spotlight: DiscoveryItem[]; family: CardVariant[]; spotlightFailed: boolean; familyFailed: boolean }

/** 검색어 부분 일치 결과를 같은 이름의 카드로 한정한다. 수집 연도나 추천 순위는 추론하지 않는다. */
export function sameNameCards(cards: CardVariant[], name: string, excludeId?: string): CardVariant[] {
  const normalized = name.trim().toLocaleLowerCase('en');
  const seen = new Set<string>();
  return cards.filter(card => {
    if (card.id === excludeId || seen.has(card.id) || card.name.trim().toLocaleLowerCase('en') !== normalized) return false;
    seen.add(card.id); return true;
  }).sort((a, b) => Number(Boolean(b.imageUrl)) - Number(Boolean(a.imageUrl)) || a.setCode.localeCompare(b.setCode) || a.cardNumber.localeCompare(b.cardNumber));
}
