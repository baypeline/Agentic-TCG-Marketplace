import { tool } from '@openai/agents';
import {
  cardSearchResponseSchema,
  idSchema,
  valuationSchema,
  type AggregatorService,
  type ValuationService,
} from '@tcg/contracts';
import { z } from 'zod';
import type { IntentDecision } from './decision.js';

export interface CardToolDependencies {
  aggregatorService: Pick<AggregatorService, 'searchCards'>;
  valuationService: ValuationService;
}

export function createCardTools(
  { aggregatorService, valuationService }: CardToolDependencies,
  route: Extract<IntentDecision['route'], 'search_cards' | 'get_valuation'>,
) {
  // 도구를 매 턴 생성하므로 다른 요청의 variant ID가 섞이지 않는다.
  const foundVariantIds = new Set<string>();
  const searchCards = tool({
    name: 'search_cards',
    description: '카드 이름으로 variant 후보를 검색합니다. query에는 세트, 카드 번호, 언어를 빼고 이름만 넣습니다.',
    parameters: z.object({ query: z.string().trim().min(1).max(200) }),
    async execute({ query }) {
      const items = await aggregatorService.searchCards({ query, limit: 10 });
      const result = cardSearchResponseSchema.parse({ items, nextCursor: null });
      for (const item of result.items) foundVariantIds.add(item.id);
      return result;
    },
    errorFunction: () => '카드 검색에 실패했습니다. 검색어를 확인해 주세요.',
  });
  if (route === 'search_cards') return [searchCards];

  return [
    searchCards,
    tool({
      name: 'get_valuation',
      description: '이번 응답의 검색에서 확인된 카드 variant ID의 적정가와 데이터 출처를 조회합니다.',
      parameters: z.object({ cardVariantId: idSchema }),
      async execute({ cardVariantId }) {
        if (!foundVariantIds.has(cardVariantId)) {
          return '먼저 카드를 검색한 뒤 검색 결과에 있는 카드 variant ID를 사용해 주세요.';
        }
        return valuationSchema.parse(await valuationService.getValuation(cardVariantId));
      },
      errorFunction: () => '적정가 조회에 실패했습니다. 카드 variant를 확인해 주세요.',
    }),
  ];
}
