import { z } from 'zod';
import { profileForNetwork } from './payment-profile.js';
export * from './payment-profile.js';
export const currencySchema = z.enum(['USDC', 'tOKRW']);
export * from '@tcg/contracts/rwa';
export const paymentModeSchema = z.enum(['X402_BASE_SEPOLIA', 'X402_MAROO_NATIVE', 'X402_MAROO_RWA']);

export const idSchema = z.uuid();
export const amountSchema = z.string().regex(/^(0|[1-9]\d*)$/, '통화 최소 단위의 정수 문자열이어야 합니다.');
export const timestampSchema = z.iso.datetime();
export const localizedCardNameSchema = z.object({
  locale: z.literal('ko'),
  name: z.string().trim().min(1),
  source: z.literal('POKEAPI_SPECIES'),
  sourceUrl: z.url(),
});
export const officialCardImageSchema=z.object({provider:z.literal('POKEMON_KOREA'),officialCardId:z.string().regex(/^[A-Z0-9]+$/),sourceUrl:z.url(),productName:z.string().min(1),printedNumber:z.string().regex(/^\d{3}\/\d{3}$/),verifiedAt:timestampSchema});
export const cardVariantSchema = z.object({
  imageSource: officialCardImageSchema.optional(),
  catalogRole: z.literal('REFERENCE').optional(),
  id: idSchema,
  game: z.literal('POKEMON'),
  name: z.string().min(1),
  setCode: z.string().min(1),
  cardNumber: z.string().min(1),
  language: z.string().min(1),
  edition: z.string().min(1),
  condition: z.string().min(1),
  imageUrl: z.url().optional(),
  localizedNames: z.array(localizedCardNameSchema).optional(),
});
export type CardVariant = z.infer<typeof cardVariantSchema>;

export const rwaTokenSchema = z.object({ assetId: idSchema, nft: z.string(), tokenId: amountSchema, custodyMode: z.literal('DEMO') });
export const agentPurchaseOfferSchema = z.object({
  rwa: rwaTokenSchema.optional(),
  listingId: idSchema, card: cardVariantSchema, price: amountSchema,
  dataSource: z.literal('SYNTHETIC_DEMO'), paymentMode: paymentModeSchema, paymentReady: z.boolean(), currency: currencySchema.optional(),
});
export type AgentPurchaseOffer = z.infer<typeof agentPurchaseOfferSchema>;
export const agentPurchaseInputSchema = z.object({
  requestId: idSchema, listingId: idSchema, action: z.enum(['prepare', 'submit', 'status', 'cancel']), paymentPayload: z.unknown().optional(),
});
export type AgentPurchaseInput = z.infer<typeof agentPurchaseInputSchema>;
export const agentPaymentRequirementsSchema = z.object({
  scheme: z.enum(['exact', 'maroo-native', 'maroo-rwa']), network: z.enum(['eip155:84532', 'eip155:450815']), asset: z.enum(['0x036CbD53842c5426634e7929541eC2318f3dCF7e', 'native:tOKRW']),
  amount: amountSchema, payTo: z.string().regex(/^0x[0-9a-fA-F]{40}$/), maxTimeoutSeconds: z.number().int().positive(), extra: z.record(z.string(), z.unknown()).default({}),
}).superRefine((value, ctx) => {
  const profile = profileForNetwork(value.network);
  if ((value.scheme !== profile.scheme && !(value.scheme === 'maroo-rwa' && value.network === 'eip155:450815')) || value.asset !== profile.asset) ctx.addIssue({ code: 'custom', message: '결제 체인·자산·방식이 일치하지 않습니다.' });
  if (value.network === 'eip155:450815' && (!z.uuid().safeParse(value.extra.tcgQuoteId).success || !z.iso.datetime().safeParse(value.extra.expiresAt).success)) ctx.addIssue({ code: 'custom', message: '마루 지급에는 주문 ID와 만료 시각이 필요합니다.' });
});
export const agentPurchaseProgressSchema = z.object({
  requestId: idSchema, listingId: idSchema, card: cardVariantSchema, amount: amountSchema, matchQuoteId: idSchema,
  status: z.enum(['PAYMENT_REQUIRED', 'PENDING', 'COMPLETED', 'CANCELLED', 'FAILED']),
  paymentMode: paymentModeSchema, expiresAt: timestampSchema, currency: currencySchema.optional(),
  signingMode: z.enum(['browser', 'server']).optional(),
  payer: z.string().regex(/^0x[0-9a-fA-F]{40}$/), recipient: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  requirements: agentPaymentRequirementsSchema.optional(), tradeId: idSchema.optional(),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/).optional(),
});
export type AgentPurchaseProgress = z.infer<typeof agentPurchaseProgressSchema>;
export const demoStatusSchema = z.object({ rwaEnabled: z.boolean().default(false), enabled: z.boolean(), paymentEnabled: z.boolean(), signingMode: z.enum(['browser', 'server']).default('browser'), paymentChain: z.enum(['base-sepolia', 'maroo']).default('base-sepolia'), currency: currencySchema.default('USDC'), decimals: z.number().int().default(6), suggestions: z.array(z.string()), payer: z.string().nullable(), recipient: z.string().nullable() });

export const agentChatReplySchema = z.object({
  content: z.string().min(1),
  cardChoices: z.array(cardVariantSchema).min(1).max(10)
    .refine(cards => new Set(cards.map(card => card.id)).size === cards.length, '중복 카드 후보는 사용할 수 없습니다.').optional(),
  purchaseOffers: z.array(agentPurchaseOfferSchema).max(10).refine(offers => new Set(offers.map(offer => offer.listingId)).size === offers.length, '중복 매물은 사용할 수 없습니다.').optional(),
});
export type AgentChatReply = z.infer<typeof agentChatReplySchema>;
export const agentTextDeltaSchema = z.object({ delta: z.string().min(1) });

export const priceObservationSchema = z.object({
  amount: amountSchema.refine(amount => /^(0|[1-9]\d*)$/.test(amount) && BigInt(amount) > 0n, '가격 표본은 양수여야 합니다.'),
  source: z.string().trim().min(1),
  observedAt: timestampSchema,
});
export type PriceObservation = z.infer<typeof priceObservationSchema>;

export const marketPriceSchema = z.object({
  id: idSchema,
  provider: z.enum(['CARDMARKET', 'TCGPLAYER']),
  providerVariant: z.string().min(1),
  priceType: z.enum(['ASKING_LOW', 'PROVIDER_MARKET', 'PROVIDER_AVERAGE', 'PROVIDER_TREND']),
  originalCurrency: z.enum(['EUR', 'USD']),
  originalAmount: z.string().regex(/^(0|[1-9]\d*)(\.\d{1,6})?$/),
  sourceUrl: z.url({ protocol: /^https$/ }),
  observedAt: timestampSchema,
  collectedAt: timestampSchema,
  eligibility: z.enum(['ELIGIBLE', 'UNVERIFIED_VARIANT', 'STALE_PRICE', 'STALE_FX', 'VARIANT_MISMATCH', 'UNSUPPORTED_PRICE_TYPE']),
  assessment: z.object({
    language: z.string(), edition: z.string(), condition: z.string(),
    matchEvidenceUrl: z.url({ protocol: /^https$/ }),
    usdcAmount: amountSchema,
    fxRate: z.string(), fxSourceUrl: z.url({ protocol: /^https$/ }),
    fxObservedAt: timestampSchema, assessedAt: timestampSchema,
  }).optional(),
});
export const marketPricesResponseSchema = z.object({
  cardVariantId: idSchema,
  dataSource: z.literal('MARKET'),
  items: z.array(marketPriceSchema),
  maxAgeHours: z.number().positive(),
  evaluatedAt: timestampSchema,
});
export type MarketPrice = z.infer<typeof marketPriceSchema>;
export type MarketPricesResponse = z.infer<typeof marketPricesResponseSchema>;

// v2.0에서 미정이던 가격 부재 및 Mock 구분의 초기 제안. 팀 합의 전 거래 판단에 사용하지 않는다.
const valuationBaseSchema = z.object({
  cardVariantId: idSchema,
  currency: currencySchema,
  sampleSize: z.number().int().nonnegative(),
  confidence: z.enum(['LOW', 'MEDIUM', 'HIGH']),
  evaluatedAt: timestampSchema,
  sourceSummary: z.array(z.string()).optional(),
  dataSource: z.enum(['MOCK', 'MARKET']),
  oldestObservedAt: timestampSchema.optional(),
  latestObservedAt: timestampSchema.optional(),
  methodology: z.enum(['MEDIAN_OF_PROVIDER_AGGREGATES', 'MEDIAN_OF_MOCK_SAMPLES', 'DEMO_USD_REFERENCE']).optional(),
  assumptions: z.array(z.string().trim().min(1)).optional(),
});
export const valuationSchema = z.discriminatedUnion('status', [
  valuationBaseSchema.extend({ status: z.literal('AVAILABLE'), estimatedPrice: amountSchema, sampleSize: z.number().int().positive(), sourceSummary: z.array(z.string().trim().min(1)).min(1) }),
  valuationBaseSchema.extend({ status: z.literal('INSUFFICIENT_DATA'), estimatedPrice: z.null(), confidence: z.literal('LOW'), sampleSize: z.literal(0) }),
]);
export type Valuation = z.infer<typeof valuationSchema>;

export const cardSearchQuerySchema = z.object({
  q: z.string().trim().max(200).default(''),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export const cardParamsSchema = z.object({ id: idSchema });
export const cardSearchResponseSchema = z.object({ items: z.array(cardVariantSchema), nextCursor: z.null() });
export const errorCodeSchema = z.enum([
  'VALIDATION_ERROR', 'UNAUTHORIZED', 'FORBIDDEN', 'CARD_NOT_FOUND', 'SESSION_NOT_FOUND', 'SESSION_BUSY',
  'LISTING_UNAVAILABLE', 'PRICE_LIMIT_EXCEEDED', 'ORDER_NOT_ACTIVE', 'IDEMPOTENCY_CONFLICT', 'TRADE_NOT_FOUND', 'POLICY_NOT_FOUND', 'PAYMENT_UNAVAILABLE',
  'INVENTORY_CONFLICT', 'BUDGET_EXCEEDED', 'POLICY_VIOLATION',
  'PAYMENT_REQUIRED', 'PAYMENT_FAILED', 'PAYMENT_UNKNOWN', 'QUOTE_EXPIRED', 'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof errorCodeSchema>;
export const errorResponseSchema = z.object({
  error: z.object({ code: errorCodeSchema, message: z.string(), retryable: z.boolean() }),
  requestId: z.string(),
});
export class AppError extends Error {
  constructor(public readonly code: ErrorCode, message: string, public readonly statusCode = 400, public readonly retryable = false) {
    super(message);
  }
}

export interface AuthContext { userId: string; agentId?: string }
export interface AggregatorService {
  searchCards(input: { query: string; limit: number }): Promise<CardVariant[]>;
  getCardVariant(id: string): Promise<CardVariant | null>;
}
export interface ValuationService { getValuation(cardVariantId: string): Promise<Valuation> }

export const inventoryItemSchema = z.object({ id: idSchema, cardVariantId: idSchema, ownerId: idSchema, status: z.enum(['AVAILABLE', 'LISTED', 'RESERVED']) });
export const listingSchema = z.object({ id: idSchema, inventoryItemId: idSchema, cardVariantId: idSchema, sellerId: idSchema, price: amountSchema, status: z.enum(['ACTIVE', 'RESERVED', 'SOLD', 'CANCELLED']), createdAt: timestampSchema, rwa: rwaTokenSchema.optional() });
export const buyOrderSchema = z.object({ id: idSchema, agentId: idSchema, cardVariantId: idSchema, maxPrice: amountSchema, status: z.enum(['ACTIVE', 'PAUSED', 'MATCH_PENDING', 'FILLED', 'CANCELLED', 'EXPIRED']), expiresAt: timestampSchema, createdAt: timestampSchema });
export const matchQuoteSchema = z.object({ id: idSchema, listingId: idSchema, inventoryItemId: idSchema, buyerAgentId: idSchema, buyOrderId: idSchema.optional(), amount: amountSchema, currency: currencySchema, status: z.enum(['RESERVED', 'PAYMENT_PENDING', 'SETTLED', 'COMPLETED', 'RELEASED', 'RECONCILING']), expiresAt: timestampSchema });
export const tradeSchema = z.object({ id: idSchema, matchQuoteId: idSchema, buyerId: idSchema, sellerId: idSchema, inventoryItemId: idSchema, price: amountSchema, paymentAttemptId: idSchema, status: z.literal('COMPLETED'), completedAt: timestampSchema });
export const spendingPolicySchema = z.object({ id: idSchema, version: z.number().int().positive(), agentId: idSchema, enabled: z.boolean(), totalBudget: amountSchema, maxPerTrade: amountSchema, allowedCardVariantIds: z.array(idSchema).optional(), minDiscountPercent: z.number().min(0).max(100).optional(), validUntil: timestampSchema });
export type InventoryItem = z.infer<typeof inventoryItemSchema>;
export type Listing = z.infer<typeof listingSchema>;
export type BuyOrder = z.infer<typeof buyOrderSchema>;
export type MatchQuote = z.infer<typeof matchQuoteSchema>;
export type Trade = z.infer<typeof tradeSchema>;
export type SpendingPolicy = z.infer<typeof spendingPolicySchema>;

// REST·MCP·Service가 함께 사용하는 거래 입력. 인증 ID는 요청 본문에서 받지 않는다.
export const tradingIdSchema = idSchema.transform(value => value.toLowerCase());
export const tradingUserSchema = z.object({ userId: tradingIdSchema });
export const tradingBuyerSchema = tradingUserSchema.extend({ agentId: tradingIdSchema });
export const createListingInputSchema = z.object({ inventoryItemId: tradingIdSchema, price: amountSchema });
export const createBuyOrderInputSchema = z.object({ cardVariantId: tradingIdSchema, maxPrice: amountSchema, expiresAt: timestampSchema });
export const fixedPurchaseInputSchema = z.object({ listingId: tradingIdSchema, maxPrice: amountSchema });
export const marketPurchaseInputSchema = z.object({ cardVariantId: tradingIdSchema, maxPrice: amountSchema });
export const listingQuerySchema = z.object({ cardVariantId: tradingIdSchema.optional(), maxPrice: amountSchema.optional() });
export const mutationContextSchema = z.object({ idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9._:-]+$/) });
export type MutationContext = z.infer<typeof mutationContextSchema>;
export type TradingBuyer = z.infer<typeof tradingBuyerSchema>;

export interface TradingExecutionContextReader {
  // 인증 사용자·Agent 쌍에 대한 서버 측 현재 상태를 반환한다. 없으면 신규 실행을 거부한다.
  getExecutionContext(buyer: TradingBuyer): Promise<{ online: boolean; policy: SpendingPolicy; availableBudget?: string } | null>;
}

export const purchaseConditionSchema = z.object({
  cardQuery: z.string().trim().min(1).max(200),
  strategy: z.enum(['FIXED', 'LIMIT', 'MARKET']),
  maxPrice: amountSchema,
  minDiscountPercent: z.number().min(0).max(100).nullable(),
});
export type PurchaseCondition = z.infer<typeof purchaseConditionSchema>;


export const policyInputSchema = spendingPolicySchema.omit({ id: true, version: true, agentId: true });
export const policyUpdateSchema = policyInputSchema.extend({ expectedVersion: z.number().int().positive() });
export const budgetSchema = z.object({ policyId: idSchema, totalBudget: amountSchema, spentAmount: amountSchema, reservedAmount: amountSchema, availableAmount: amountSchema });
export const paymentStatusSchema = z.enum(['REQUIRED', 'PENDING', 'UNKNOWN', 'FAILED', 'SETTLED']);
export const tradeProgressSchema = z.enum(['NOT_STARTED', 'FINALIZING', 'COMPLETED']);
export const purchaseStatusSchema = z.object({
  id: idSchema, paymentAttemptId: idSchema.nullable(), policyId: idSchema.nullable(), policyVersion: z.number().int().positive().nullable(),
  amount: amountSchema, quoteStatus: matchQuoteSchema.shape.status, paymentStatus: paymentStatusSchema.nullable(), tradeStatus: tradeProgressSchema,
  holdReasons: z.array(z.string()), expiresAt: timestampSchema, remainingMs: z.number().nonnegative(),
  transactionHash: z.string().nullable(), needsReview: z.boolean(), retryPaymentAllowed: z.boolean(),
  network: z.enum(['eip155:84532', 'eip155:450815']).optional(), currency: currencySchema.optional(),
});
export type PurchaseStatus = z.infer<typeof purchaseStatusSchema>;
export const agentRunInputSchema = z.object({ policyId: idSchema, instruction: z.string().trim().min(1).max(4000) });
export const agentRunSchema = z.object({ id: idSchema, policyId: idSchema, status: z.enum(['RUNNING', 'STOPPED', 'COMPLETED', 'FAILED']), instruction: z.string(), expiresAt: timestampSchema, result: z.string().nullable() });
export type AgentRun = z.infer<typeof agentRunSchema>;
