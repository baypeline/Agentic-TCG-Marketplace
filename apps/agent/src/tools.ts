import { tool } from '@openai/agents';
import {
  cardSearchResponseSchema,
  idSchema,
  valuationSchema,
  type AggregatorService,
  type ValuationService,
  type CardVariant,
  listingSchema,
  agentPurchaseOfferSchema,
  type Listing,
  type AgentPurchaseOffer,
} from '@tcg/contracts';
import { z } from 'zod';
import type { IntentDecision } from './decision.js';

export interface CardToolDependencies {
  aggregatorService: Pick<AggregatorService, 'searchCards'>;
  valuationService: ValuationService;
  marketplaceService?: { paymentReady: boolean; listListings(cardVariantId: string): Promise<Listing[]> };
}

export function createCardTools(
  { aggregatorService, valuationService, marketplaceService }: CardToolDependencies,
  route: Extract<IntentDecision['route'], 'search_cards' | 'get_valuation'>,
  onCardChoices?: (cards: CardVariant[]) => void,
  onPurchaseOffers?: (offers: AgentPurchaseOffer[]) => void,
) {
  // 도구를 매 턴 생성하므로 다른 요청의 variant ID가 섞이지 않는다.
  const foundVariants = new Map<string, CardVariant>();
  const searchCards = tool({
    name: 'search_cards',
    description: '카드 이름으로 variant 후보를 검색합니다. query에는 세트, 카드 번호, 언어를 빼고 이름만 넣습니다.',
    parameters: z.object({ query: z.string().trim().min(1).max(200) }),
    async execute({ query }) {
      const items = await aggregatorService.searchCards({ query, limit: 10 });
      const result = cardSearchResponseSchema.parse({ items, nextCursor: null });
      for (const item of result.items) foundVariants.set(item.id, item);
      return result;
    },
    errorFunction: () => '카드 검색에 실패했습니다. 검색어를 확인해 주세요.',
  });
  const choiceTools = onCardChoices ? [tool({
    name: 'show_card_choices',
    description: '사용자가 고를 카드 후보를 선택 버튼으로 표시합니다. 이번 턴 search_cards 결과의 ID만 사용합니다.',
    parameters: z.object({ cardVariantIds: z.array(idSchema).min(1).max(10).refine(ids => new Set(ids).size === ids.length, '중복 카드 ID는 사용할 수 없습니다.') }),
    async execute({ cardVariantIds }) {
      const cards = cardVariantIds.map(id => foundVariants.get(id));
      if (cards.some(card => !card)) return '이번 턴의 검색 결과에 있는 카드만 후보로 표시할 수 있습니다. 먼저 카드를 검색하세요.';
      onCardChoices(cards as CardVariant[]);
      return { displayedCardIds: cardVariantIds };
    },
    errorFunction: () => '카드 선택 버튼을 표시하지 못했습니다. 검색 결과의 ID를 확인해 주세요.',
  })] : [];
  const marketplaceTools = marketplaceService ? [tool({
    name: 'list_listings',
    description: '이번 턴에 검색한 카드의 현재 매물을 조회하고 구매 버튼을 표시합니다. 조회 자체로 예약·결제하지 않습니다.',
    parameters: z.object({ cardVariantId: idSchema }),
    async execute({ cardVariantId }) {
      const card = foundVariants.get(cardVariantId);
      if (!card) return '이번 턴에 검색한 카드만 매물을 조회할 수 있습니다. 먼저 카드를 검색하세요.';
      const listings = z.array(listingSchema).parse(await marketplaceService.listListings(cardVariantId)).filter(listing => listing.cardVariantId === card.id && listing.status === 'ACTIVE');
      listings.sort((a, b) => BigInt(a.price) < BigInt(b.price) ? -1 : BigInt(a.price) > BigInt(b.price) ? 1 : a.id.localeCompare(b.id));
      const offers = listings.slice(0, 3).map(listing => agentPurchaseOfferSchema.parse({ listingId: listing.id, card, price: listing.price, dataSource: 'SYNTHETIC_DEMO', paymentMode: 'X402_BASE_SEPOLIA', paymentReady: marketplaceService.paymentReady }));
      onPurchaseOffers?.(offers);
      return { listings, availableCount: listings.length, dataSource: 'SYNTHETIC_DEMO', paymentMode: 'X402_BASE_SEPOLIA', paymentReady: marketplaceService.paymentReady, purchaseRequiresWalletSignature: true };
    },
    errorFunction: () => '매물 조회에 실패했습니다. 거래 가능 여부를 확인할 수 없습니다.',
  })] : [];
  if (route === 'search_cards' && !marketplaceService) return [searchCards, ...choiceTools];

  return [
    searchCards,
    tool({
      name: 'get_valuation',
      description: '이번 응답의 검색에서 확인된 카드 variant ID의 적정가와 데이터 출처를 조회합니다.',
      parameters: z.object({ cardVariantId: idSchema }),
      async execute({ cardVariantId }) {
        if (!foundVariants.has(cardVariantId)) {
          return '먼저 카드를 검색한 뒤 검색 결과에 있는 카드 variant ID를 사용해 주세요.';
        }
        return valuationSchema.parse(await valuationService.getValuation(cardVariantId));
      },
      errorFunction: () => '적정가 조회에 실패했습니다. 카드 variant를 확인해 주세요.',
    }),
    ...choiceTools,
    ...marketplaceTools,
  ];
}
