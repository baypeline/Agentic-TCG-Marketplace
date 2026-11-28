import { cardVariantSchema, type CardVariant } from '@tcg/contracts';

export interface CatalogCandidate {
  card: CardVariant;
  prices: { amount: string; observedAt: Date }[];
  hasInventory: boolean;
}
export interface CatalogCuration {
  priceSource: 'mock' | 'market';
  maxCards: number;
  now?: () => Date;
}
const missing = new Set(['', 'UNSPECIFIED', 'UNKNOWN', 'N/A']);
/** Select before search/limit so incomplete rows cannot displace usable cards. */
export function selectCuratedCards(candidates: CatalogCandidate[], options: CatalogCuration): CardVariant[] {
  const now = (options.now?.() ?? new Date()).getTime();
  const complete = candidates.filter(({ card, prices }) => {
    if (!cardVariantSchema.safeParse(card).success || !card.imageUrl || !['KO','EN'].includes(card.language)) return false;
    if ([card.name,card.setCode,card.cardNumber,card.edition,card.condition].some(value => missing.has(value.trim().toUpperCase()))) return false;
    try { if (new URL(card.imageUrl).protocol !== 'https:') return false; } catch { return false; }
    return prices.some(price => {
      const age = now - price.observedAt.getTime();
      return /^(0|[1-9]\d*)(\.\d+)?$/.test(price.amount) && /[1-9]/.test(price.amount) && age >= 0 && (options.priceSource === 'mock' || age <= 72*3600000);
    });
  });
  return complete.sort((a,b) => Number(b.card.language === 'KO')-Number(a.card.language === 'KO') || Number(b.hasInventory)-Number(a.hasInventory) || a.card.setCode.localeCompare(b.card.setCode) || a.card.cardNumber.localeCompare(b.card.cardNumber, 'en', { numeric:true }) || a.card.id.localeCompare(b.card.id))
    .slice(0,options.maxCards).map(row => row.card);
}
