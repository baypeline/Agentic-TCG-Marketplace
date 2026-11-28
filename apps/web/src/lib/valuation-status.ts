import type { CardVariant, MarketPricesResponse, Valuation } from '@tcg/contracts';

const reasons = {
  UNVERIFIED_VARIANT: '가격은 수집됐지만 판본·보존 상태와 USDC 환율 근거가 확인되지 않았어요.',
  STALE_PRICE: '제공자 가격의 유효기간이 지났어요. 새 가격 자료가 필요해요.',
  STALE_FX: 'USDC 환율 근거의 유효기간이 지났어요.',
  VARIANT_MISMATCH: '검증한 가격의 언어·에디션·보존 상태가 이 카드와 일치하지 않아요.',
  UNSUPPORTED_PRICE_TYPE: '최저 판매 희망가와 추세 가격은 참고용이며 적정가 계산에 사용하지 않아요.',
} as const;

export function getValuationStatus(valuation: Valuation, prices?: MarketPricesResponse | null, card?: Pick<CardVariant, 'edition' | 'condition'>) {
  if (valuation.status === 'AVAILABLE') return null;
  if (valuation.dataSource === 'MOCK') return { title: '가격 표본이 없어요', reasons: ['이 카드에 연결된 가격 표본이 없어 참고 가격을 표시하지 않아요.'] };
  if (valuation.methodology === 'DEMO_USD_REFERENCE') return { title: '참고할 USD 가격이 없어요', reasons: ['최근 TCGplayer 시장 집계가가 필요해요. EUR 가격·판매 희망가나 오래된 가격은 이 평가에 사용하지 않아요.'] };
  if (!prices || prices.cardVariantId !== valuation.cardVariantId) return { title: '평가에 쓸 자료가 부족해요', reasons: ['참고 시세의 수집·검증 상태를 확인하지 못했어요. 잠시 후 다시 확인해 주세요.'] };
  if (!prices.items.length) return { title: '수집된 가격이 없어요', reasons: ['이 카드에 수집된 외부 가격이 없어요. 가격이 0이라는 뜻은 아니에요.'] };
  const details: string[] = [];
  if (card && [card.edition, card.condition].some(value => value.toUpperCase() === 'UNSPECIFIED')) details.push('이 카드의 에디션·보존 상태가 미확정이라 같은 조건의 가격인지 확인해야 해요.');
  for (const status of new Set(prices.items.map(price => price.eligibility))) {
    if (status !== 'ELIGIBLE') details.push(reasons[status]);
  }
  return { title: '참고 시세만 확인할 수 있어요', reasons: details.length ? details : ['참고 시세와 평가 결과가 다른 시점에 조회됐을 수 있어요. 다시 확인해 주세요.'] };
}
