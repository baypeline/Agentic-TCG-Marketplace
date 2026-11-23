import { z } from 'zod';
import { idSchema, timestampSchema, type MarketPricesResponse } from '@tcg/contracts';

export const positiveDecimal = z.string().regex(/^(0|[1-9]\d{0,14})(\.\d{1,6})?$/).refine(value => decimalToMicros(value) > 0n);
export function decimalToMicros(value: string): bigint {
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, '0'));
}
export const httpsUrl = z.url({ protocol: /^https$/ });
export const snapshotInputSchema = z.object({
  provider: z.enum(['CARDMARKET', 'TCGPLAYER']),
  externalId: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/),
  providerVariant: z.string().trim().min(1).max(64),
  priceType: z.enum(['ASKING_LOW', 'PROVIDER_MARKET', 'PROVIDER_AVERAGE', 'PROVIDER_TREND']),
  originalCurrency: z.enum(['USD', 'EUR']),
  originalAmount: positiveDecimal,
  sourceUrl: httpsUrl,
  observedAt: timestampSchema,
}).superRefine((value, ctx) => {
  if ((value.provider === 'CARDMARKET' ? 'EUR' : 'USD') !== value.originalCurrency) ctx.addIssue({ code: 'custom', message: '제공자 통화가 일치하지 않습니다.' });
});
export type SnapshotInput = z.infer<typeof snapshotInputSchema>;
export interface MarketPriceProvider { getPrices(externalId: string): Promise<SnapshotInput[]> }
const attribute = z.string().trim().min(1).max(64).refine(value => value.toUpperCase() !== 'UNSPECIFIED', '확정되지 않은 카드 속성은 승인할 수 없습니다.');
export const assessmentInputSchema = z.object({
  snapshotId: idSchema,
  language: attribute,
  edition: attribute,
  condition: attribute,
  matchEvidenceUrl: httpsUrl,
  // 원본 통화 1단위당 USDC. USD = USDC라는 가정은 하지 않는다.
  fxRate: positiveDecimal,
  fxSourceUrl: httpsUrl,
  fxObservedAt: timestampSchema,
});
export type AssessmentInput = z.infer<typeof assessmentInputSchema>;
export interface MarketPriceService {
  getPrices(cardVariantId: string): Promise<MarketPricesResponse>;
}
