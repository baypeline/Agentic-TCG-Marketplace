import { decimalToMicros } from './market-types.js';

export const demoPriceAssumptions = ['1 USD ≈ 1 USDC로 표시하는 데모 환산입니다.', '판본·보존 상태를 보정하지 않은 카탈로그 참고 추정가입니다.'];
const variants = ['normal', 'unlimited', 'holofoil', 'unlimited-holofoil', 'reverse-holofoil', '1st-edition', '1st-edition-holofoil'];

interface UsdPrice {
  provider: string; originalCurrency: string; priceType: string; providerVariant: string;
  originalAmount: string; observedAt: string | Date;
}

export function selectDemoUsdPrice<T extends UsdPrice>(rows: T[], at: Date, maxAgeHours: number): T | undefined {
  // 판본별 가격을 평균내지 않는다. 일반판 우선으로 대표 가격 한 개를 고른다.
  return rows.filter(row => {
    const time = new Date(row.observedAt).getTime();
    return row.provider === 'TCGPLAYER' && row.originalCurrency === 'USD' && row.priceType === 'PROVIDER_MARKET'
      && variants.includes(row.providerVariant) && time <= at.getTime() && time >= at.getTime() - maxAgeHours * 3_600_000
      && decimalToMicros(row.originalAmount) > 0n;
  }).sort((a, b) => variants.indexOf(a.providerVariant) - variants.indexOf(b.providerVariant) || new Date(b.observedAt).getTime() - new Date(a.observedAt).getTime())[0];
}
