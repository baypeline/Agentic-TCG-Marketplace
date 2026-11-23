import { AppError, idSchema, marketPricesResponseSchema, type CardVariant, type MarketPrice } from '@tcg/contracts';
import type { PrismaClient } from '@tcg/db';
import { z } from 'zod';
import { assessmentInputSchema, decimalToMicros, snapshotInputSchema, type AssessmentInput, type MarketPriceProvider, type MarketPriceService } from './market-types.js';
import { MarketPriceError } from './tcgdex-prices.js';
import type { PriceDataAdapter } from './index.js';

const hour = 3_600_000;
export const DEFAULT_PRICE_MAX_AGE_HOURS = 72;
export const DEFAULT_FX_MAX_AGE_HOURS = 24;
async function loadRows(prisma: PrismaClient, cardVariantId: string) {
  return prisma.marketPriceSnapshot.findMany({ where: { cardVariantId }, include: { assessment: true }, orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], take: 1000 });
}
type Snapshot = Awaited<ReturnType<typeof loadRows>>[number];
function latestRows(rows: Snapshot[]) {
  const seen = new Set<string>();
  return rows.filter(row => {
    const key = JSON.stringify([row.provider, row.providerVariant, row.priceType]);
    if (seen.has(key)) return false;
    seen.add(key); return true;
  });
}
export function createMarketPriceServices(options: { prisma: PrismaClient; provider?: MarketPriceProvider; now?: () => Date; maxAgeHours?: number; fxMaxAgeHours?: number }) {
  const { prisma, provider } = options;
  const now = options.now ?? (() => new Date());
  const maxAgeHours = z.number().positive().max(720).parse(options.maxAgeHours ?? DEFAULT_PRICE_MAX_AGE_HOURS);
  const fxMaxAgeHours = z.number().positive().max(168).parse(options.fxMaxAgeHours ?? DEFAULT_FX_MAX_AGE_HOURS);
  function eligibility(row: Snapshot, card: CardVariant | { language: string; edition: string; condition: string }, at: Date): MarketPrice['eligibility'] {
    if (row.observedAt.getTime() > at.getTime() || row.observedAt.getTime() < at.getTime() - maxAgeHours * hour) return 'STALE_PRICE';
    if (!((row.provider === 'TCGPLAYER' && row.priceType === 'PROVIDER_MARKET') || (row.provider === 'CARDMARKET' && row.priceType === 'PROVIDER_AVERAGE'))) return 'UNSUPPORTED_PRICE_TYPE';
    const a = row.assessment;
    if (!a) return 'UNVERIFIED_VARIANT';
    if ([card.language, card.edition, card.condition].some(value => value.toUpperCase() === 'UNSPECIFIED') || a.language !== card.language || a.edition !== card.edition || a.condition !== card.condition) return 'VARIANT_MISMATCH';
    if (a.fxObservedAt.getTime() > at.getTime() || a.fxObservedAt.getTime() < at.getTime() - fxMaxAgeHours * hour) return 'STALE_FX';
    return 'ELIGIBLE';
  }
  async function getCard(id: string) {
    const card = await prisma.cardVariant.findUnique({ where: { id: idSchema.parse(id) }, include: { externalIdentity: true } });
    if (!card) throw new AppError('CARD_NOT_FOUND', '카드를 찾을 수 없습니다.', 404);
    return card;
  }
  const marketPriceService: MarketPriceService = { async getPrices(cardVariantId) {
    const card = await getCard(cardVariantId); const at = now();
    const rows = latestRows(await loadRows(prisma, card.id));
    return marketPricesResponseSchema.parse({ cardVariantId: card.id, dataSource: 'MARKET', maxAgeHours, evaluatedAt: at.toISOString(), items: rows.map(row => ({
      id: row.id, provider: row.provider, providerVariant: row.providerVariant, priceType: row.priceType,
      originalCurrency: row.originalCurrency, originalAmount: row.originalAmount, sourceUrl: row.sourceUrl,
      observedAt: row.observedAt.toISOString(), collectedAt: row.collectedAt.toISOString(), eligibility: eligibility(row, card, at),
      ...(row.assessment ? { assessment: { ...row.assessment, fxObservedAt: row.assessment.fxObservedAt.toISOString(), assessedAt: row.assessment.assessedAt.toISOString() } } : {}),
    })) });
  } };
  const adapter: PriceDataAdapter = { dataSource: 'MARKET', sourceSummary: [], async getObservations(cardVariantId) {
    const card = await getCard(cardVariantId); const at = now();
    // 같은 제공자의 일별 스냅샷을 거래 표본처럼 중복 계산하지 않는다.
    const rows = latestRows(await loadRows(prisma, card.id)).filter(row => eligibility(row, card, at) === 'ELIGIBLE');
    const providers = new Set<string>();
    return rows.filter(row => {
      if (providers.has(row.provider)) return false;
      providers.add(row.provider); return true;
    }).map(row => ({ amount: row.assessment!.usdcAmount, source: `${row.provider}:${row.providerVariant}:${row.priceType} ${row.sourceUrl}`, observedAt: row.observedAt.toISOString() }));
  } };
  return {
    marketPriceService, adapter,
    async collectPrices(cardVariantId: string) {
      const card = await getCard(cardVariantId);
      if (!provider) throw new AppError('VALIDATION_ERROR', '가격 수집 제공자가 필요합니다.', 400);
      const identity = card.externalIdentity;
      if (!identity || identity.provider !== 'TCGDEX' || identity.language !== 'EN' || card.language !== 'EN' || identity.id !== card.id) throw new AppError('VALIDATION_ERROR', 'TCGdex 영어 카탈로그와 연결된 카드만 수집할 수 있습니다.', 400);
      const raw = await provider.getPrices(identity.externalId);
      const inputs = z.array(snapshotInputSchema).max(100).parse(raw);
      const collectedAt = now(); const keys = new Set<string>();
      for (const input of inputs) {
        const key = JSON.stringify([input.provider, input.providerVariant, input.priceType, Date.parse(input.observedAt)]);
        if (keys.has(key) || input.externalId !== identity.externalId || Date.parse(input.observedAt) > collectedAt.getTime()) throw new MarketPriceError('INVALID_DATA');
        keys.add(key);
      }
      const result = await prisma.$transaction(async tx => {
        // DB 유일성 제약으로 동시 실행도 동일 스냅샷을 한 번만 삽입한다.
        const inserted = await tx.marketPriceSnapshot.createMany({ data: inputs.map(input => ({ ...input, cardVariantId: card.id, collectedAt })), skipDuplicates: true });
        for (const input of inputs) {
          const row = await tx.marketPriceSnapshot.findUniqueOrThrow({ where: { marketSnapshot: { cardVariantId: card.id, provider: input.provider, providerVariant: input.providerVariant, priceType: input.priceType, observedAt: input.observedAt } } });
          // 같은 제공자 타임스탬프의 가격을 조용히 덮어쓰거나 승인된 가격을 바꾸지 않는다.
          if (decimalToMicros(row.originalAmount) !== decimalToMicros(input.originalAmount) || row.originalCurrency !== input.originalCurrency || row.externalId !== input.externalId || row.sourceUrl !== input.sourceUrl) throw new MarketPriceError('SNAPSHOT_CONFLICT');
        }
        return inserted.count;
      });
      return { cardVariantId: card.id, received: inputs.length, inserted: result, collectedAt: collectedAt.toISOString() };
    },
    async assessPrice(input: AssessmentInput) {
      const data = assessmentInputSchema.parse(input); const at = now();
      if (Date.parse(data.fxObservedAt) > at.getTime() || Date.parse(data.fxObservedAt) < at.getTime() - fxMaxAgeHours * hour) throw new AppError('VALIDATION_ERROR', '환율 관측 시각이 허용 범위를 벗어났습니다.', 400);
      return prisma.$transaction(async tx => {
        const row = await tx.marketPriceSnapshot.findUnique({ where: { id: data.snapshotId }, include: { cardVariant: true } });
        if (!row) throw new AppError('VALIDATION_ERROR', '가격 스냅샷을 찾을 수 없습니다.', 400);
        if (data.language !== row.cardVariant.language || data.edition !== row.cardVariant.edition || data.condition !== row.cardVariant.condition) throw new AppError('VALIDATION_ERROR', '확인한 언어·에디션·상태가 카드와 다릅니다.', 400);
        if (row.observedAt.getTime() > at.getTime() || row.observedAt.getTime() < at.getTime() - maxAgeHours * hour) throw new AppError('VALIDATION_ERROR', '오래된 가격은 평가에 사용할 수 없습니다.', 400);
        if (!((row.provider === 'TCGPLAYER' && row.priceType === 'PROVIDER_MARKET') || (row.provider === 'CARDMARKET' && row.priceType === 'PROVIDER_AVERAGE'))) throw new AppError('VALIDATION_ERROR', '판매 희망가와 추세 가격은 평가 표본으로 승인하지 않습니다.', 400);
        const usdcAmount = (decimalToMicros(row.originalAmount) * decimalToMicros(data.fxRate) / 1_000_000n).toString();
        if (usdcAmount === '0') throw new AppError('VALIDATION_ERROR', '환산 가격이 최소 단위보다 작습니다.', 400);
        const { snapshotId, ...fields } = data;
        return tx.marketPriceAssessment.upsert({ where: { snapshotId }, create: { snapshotId, ...fields, usdcAmount, assessedAt: at }, update: { ...fields, usdcAmount, assessedAt: at } });
      });
    },
  };
}
