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
  query?: string;
  preferredCardIds?: readonly string[];
}
const missing = new Set(['', 'UNSPECIFIED', 'UNKNOWN', 'N/A']);
/** Validate first, match the search, then rank by print language before applying limits. */
export function selectCuratedCards(candidates: CatalogCandidate[], options: CatalogCuration): CardVariant[] {
  const now = (options.now?.() ?? new Date()).getTime();
  const complete = candidates.filter(({ card, prices }) => {
    if (!cardVariantSchema.safeParse(card).success || !card.imageUrl || !['KO','EN'].includes(card.language)) return false;
    if ([card.name,card.setCode,card.cardNumber].some(value => missing.has(value.trim().toUpperCase()))) return false;
    try { if (new URL(card.imageUrl).protocol !== 'https:') return false; } catch { return false; }
    if(card.language==='KO'&&card.catalogRole==='REFERENCE'&&card.imageSource?.provider==='POKEMON_KOREA'&&card.imageSource.printedNumber.split('/')[0]===card.cardNumber)return true;
    if([card.edition,card.condition].some(value=>missing.has(value.trim().toUpperCase())))return false;
    return prices.some(price => {
      const age = now - price.observedAt.getTime();
      return /^(0|[1-9]\d*)(\.\d+)?$/.test(price.amount) && /[1-9]/.test(price.amount) && age >= 0 && (options.priceSource === 'mock' || age <= 72*3600000);
    });
  });
  const search=(options.query??'').normalize('NFKC').trim().toLowerCase();
  const printKey=(card:CardVariant)=>JSON.stringify([card.language,card.setCode,card.cardNumber,card.imageSource?.officialCardId]);
  const tradablePrints=new Set(complete.filter(c=>c.card.catalogRole!=='REFERENCE'&&c.card.imageSource).map(c=>printKey(c.card)));
  const preferred = new Map(options.preferredCardIds?.map((id, rank) => [id, rank]));
  const rank = (card: CardVariant) => preferred.get(card.id) ?? Number.MAX_SAFE_INTEGER;
  return complete.filter(({card})=>(card.catalogRole!=='REFERENCE'||!tradablePrints.has(printKey(card)))&&(card.name.normalize('NFKC').toLowerCase().includes(search)||card.localizedNames?.some(n=>n.name.normalize('NFKC').toLowerCase().includes(search)))).sort((a,b) => Number(b.card.language === 'KO')-Number(a.card.language === 'KO') || rank(a.card)-rank(b.card) || Number(b.hasInventory)-Number(a.hasInventory) || a.card.setCode.localeCompare(b.card.setCode) || a.card.cardNumber.localeCompare(b.card.cardNumber, 'en', { numeric:true }) || a.card.id.localeCompare(b.card.id))
    .slice(0,options.maxCards).map(row => row.card);
}
