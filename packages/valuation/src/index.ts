import type { FastifyPluginAsync } from 'fastify';
import type { PrismaClient } from '@tcg/db';
import { demoPriceObservations, demoPriceSource } from '@tcg/contracts/fixtures';
import { AppError, cardParamsSchema, priceObservationSchema, valuationSchema, marketPricesResponseSchema, type AggregatorService, type ValuationService, type PriceObservation, type Valuation } from '@tcg/contracts';
import type { MarketPriceService } from './market-types.js';
export { createTcgdexPriceProvider, MarketPriceError } from './tcgdex-prices.js';
export { createMarketPriceServices } from './market-prices.js';
export { assessmentInputSchema } from './market-types.js';
export type { MarketPriceService, MarketPriceProvider, SnapshotInput, AssessmentInput } from './market-types.js';

export type { ValuationService } from '@tcg/contracts';
export type { PriceObservation } from '@tcg/contracts';
export interface PriceDataAdapter {
  dataSource: 'MOCK' | 'MARKET';
  sourceSummary: string[];
  methodology?: Valuation['methodology'];
  assumptions?: string[];
  getObservations(cardVariantId: string): Promise<PriceObservation[]>;
}
export interface ValuationDependencies {
  aggregatorService: AggregatorService;
  adapter: PriceDataAdapter;
  now?: () => Date;
}
export function createValuationService({ aggregatorService, adapter, now = () => new Date() }: ValuationDependencies): ValuationService {
  return {
    async getValuation(cardVariantId) {
      if (!await aggregatorService.getCardVariant(cardVariantId)) throw new AppError('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.', 404);
      const evaluatedAt = now().toISOString();
      const samples = (await adapter.getObservations(cardVariantId)).map(sample => {
        const result = priceObservationSchema.safeParse(sample);
        if (!result.success || Date.parse(result.data.observedAt) > Date.parse(evaluatedAt)) {
          throw new AppError('INTERNAL_ERROR', '가격 제공자의 표본 형식이나 관측 시각이 올바르지 않습니다.', 500);
        }
        return result.data;
      });
      const sourceSummary = [...new Set([...adapter.sourceSummary, ...samples.map(sample => sample.source)])];
      const times = samples.map(sample => sample.observedAt).sort((a, b) => Date.parse(a) - Date.parse(b));
      const base = { cardVariantId, currency: 'USDC' as const, sampleSize: samples.length, confidence: 'LOW' as const, evaluatedAt, dataSource: adapter.dataSource, sourceSummary,
        methodology: adapter.methodology ?? (adapter.dataSource === 'MOCK' ? 'MEDIAN_OF_MOCK_SAMPLES' as const : 'MEDIAN_OF_PROVIDER_AGGREGATES' as const),
        ...(adapter.assumptions ? { assumptions: adapter.assumptions } : {}),
        ...(times.length ? { oldestObservedAt: times[0], latestObservedAt: times[times.length - 1] } : {}),
      };
      if (samples.length === 0) return valuationSchema.parse({ ...base, status: 'INSUFFICIENT_DATA', estimatedPrice: null });
      // 초기 추정기는 정수 단위 중앙값만 사용한다. 통계적 신뢰 수준은 후속 평가 모델에서 확정.
      const amounts = samples.map(sample => BigInt(sample.amount)).sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      const middle = Math.floor(amounts.length / 2);
      const estimatedPrice = amounts.length % 2 ? amounts[middle]! : (amounts[middle - 1]! + amounts[middle]!) / 2n;
      return valuationSchema.parse({ ...base, status: 'AVAILABLE', estimatedPrice: estimatedPrice.toString() });
    },
  };
}
export function createMockPriceAdapter(): PriceDataAdapter {
  return {
    dataSource: 'MOCK',
    sourceSummary: [demoPriceSource],
    async getObservations(id) {
      return demoPriceObservations.filter(sample => sample.cardVariantId === id).map(sample => ({ amount: sample.amount, source: sample.source, observedAt: sample.observedAt }));
    },
  };
}
/** 시연용 DB 표본만 조회한다. 실제 시세 어댑터와 혼합하지 않는다. */
export function createPrismaMockPriceAdapter(prisma: PrismaClient): PriceDataAdapter {
  return {
    dataSource: 'MOCK', sourceSummary: [demoPriceSource],
    async getObservations(cardVariantId) {
      const rows = await prisma.priceObservation.findMany({
        where: { cardVariantId, dataSource: 'MOCK' },
        orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], take: 100,
      });
      return rows.map(row => ({ amount: row.amount, source: row.source, observedAt: row.observedAt.toISOString() }));
    },
  };
}
export interface ValuationPluginDependencies { valuationService: ValuationService; marketPriceService?: MarketPriceService }
export function createValuationPlugin({ valuationService, marketPriceService }: ValuationPluginDependencies): FastifyPluginAsync {
  return async app => {
    app.get('/cards/:id/valuation', async request => {
      const { id } = cardParamsSchema.parse(request.params);
      return valuationSchema.parse(await valuationService.getValuation(id));
    });
    if (marketPriceService) app.get('/cards/:id/prices', async request => {
      const { id } = cardParamsSchema.parse(request.params);
      return marketPricesResponseSchema.parse(await marketPriceService.getPrices(id));
    });
  };
}
