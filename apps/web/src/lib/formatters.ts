import type { CardVariant, MarketPrice, MarketPricesResponse, Valuation } from '@tcg/contracts';

export function getCardDisplayName(card: CardVariant): string { return card.localizedNames?.find(name => name.locale === 'ko')?.name ?? card.name; }
export function getValuationLabel(valuation: Valuation): string {
  return valuation.dataSource === 'MOCK' ? '데모 가격' : valuation.methodology === 'DEMO_USD_REFERENCE' ? '데모 참고 추정가' : '추정 적정가';
}
export function formatUsdc(amount: string): string {
  const value = BigInt(amount);
  const whole = (value / 1_000_000n).toLocaleString('en-US');
  const fraction = (value % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole}${fraction ? `.${fraction}` : ''} USDC`;
}
export function formatSet(code: string): string { return ({ base1: 'Base Set', base2: 'Jungle', SV: '데모 세트' } as Record<string, string>)[code] ?? code; }
export function formatAttribute(value: string): string { return value === 'UNSPECIFIED' ? '미확정' : value; }
export function formatProvider(value: string): string { return value === 'CARDMARKET' ? 'Cardmarket' : value === 'TCGPLAYER' ? 'TCGplayer' : value; }
export function formatVariant(value: string): string { return ({ normal: '일반판', holo: '홀로', holofoil: '홀로포일', 'reverse-holofoil': '리버스 홀로', '1st-edition': '초판', unlimited: '언리미티드', '1st-edition-holofoil': '초판 홀로', 'unlimited-holofoil': '언리미티드 홀로' } as Record<string, string>)[value] ?? value; }
export function formatUtc(value: string): string { return value.replace('T', ' ').replace(/\.\d+Z$/, '').replace(/Z$/, ''); }
export const priceTypeLabels: Record<MarketPrice['priceType'], string> = { ASKING_LOW: '최저 판매 희망가', PROVIDER_MARKET: '제공자 시장 집계가', PROVIDER_AVERAGE: '제공자 평균가', PROVIDER_TREND: '제공자 추세가' };
export const eligibilityLabels: Record<MarketPrice['eligibility'], string> = { ELIGIBLE: '평가 사용 가능', UNVERIFIED_VARIANT: '판본·환율 검증 필요', STALE_PRICE: '가격 자료 만료', STALE_FX: '환율 자료 만료', VARIANT_MISMATCH: '카드 속성 불일치', UNSUPPORTED_PRICE_TYPE: '참고 전용 가격 유형' };
export interface CatalogItem { card: CardVariant; valuation: Valuation | null; prices: MarketPricesResponse | null; valuationFailed: boolean; pricesFailed: boolean }
export function getReferencePrice(prices: MarketPricesResponse | null): MarketPrice | undefined {
  const rows = prices?.items ?? [];
  return rows.find(p => p.priceType === 'PROVIDER_AVERAGE' && p.providerVariant === 'normal')
    ?? rows.find(p => p.priceType === 'PROVIDER_MARKET' && p.providerVariant === 'normal')
    ?? rows.find(p => p.priceType === 'PROVIDER_AVERAGE' || p.priceType === 'PROVIDER_MARKET');
}
