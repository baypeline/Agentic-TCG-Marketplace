import type { TradingService } from '@tcg/trading';
import type { PaymentService } from '@tcg/payment-server';
import { AppError, createBuyOrderInputSchema, fixedPurchaseInputSchema, marketPurchaseInputSchema, listingQuerySchema, mutationContextSchema, type TradingBuyer } from '@tcg/contracts';
import type { ToolAnnotations } from '@modelcontextprotocol/server';
import { z } from 'zod';
import {
  cardSearchResponseSchema,
  idSchema,
  valuationSchema,
  type AggregatorService,
  type AuthContext,
  type ValuationService,
} from '@tcg/contracts';

export interface ToolServices {
  aggregatorService: AggregatorService;
  valuationService: ValuationService;
  tradingService?: TradingService;
  paymentService?: PaymentService;
}

// 호스트가 검증한 인증 정보. 거래 도구를 붙일 때 쓴다.
export interface ToolContext {
  auth: AuthContext | null;
  requestKey?: string;
  paymentPayload?: unknown;
}

export type ToolInvocation =
  | { kind: 'invalid'; issues: string }
  | { kind: 'done'; data: unknown };

export interface ToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: z.ZodObject;
  readonly annotations: ToolAnnotations;
  invoke(rawArgs: unknown, context: ToolContext): Promise<ToolInvocation>;
}

const readOnly: ToolAnnotations = { readOnlyHint: true, openWorldHint: false };

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map(issue => (issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ${issue.message}` : issue.message))
    .join('; ');
}

// 입력 검증 실패만 invalid로 돌려준다. 실행 중에 던진 예외(서비스 출력 검증 포함)는 호출한 쪽이 처리한다.
function defineTool<S extends z.ZodObject>(spec: {
  name: string;
  description: string;
  inputSchema: S;
  annotations: ToolAnnotations;
  run: (args: z.output<S>, context: ToolContext) => Promise<unknown>;
}): ToolDefinition {
  const { run, ...definition } = spec;
  return {
    ...definition,
    async invoke(rawArgs, context) {
      const parsed = spec.inputSchema.safeParse(rawArgs);
      if (!parsed.success) return { kind: 'invalid', issues: formatIssues(parsed.error) };
      return { kind: 'done', data: await run(parsed.data, context) };
    },
  };
}

// REST GET /api/cards와 같은 규칙. MCP 인수는 JSON이라 limit을 숫자로 받는다.
const searchCardsInput = z.strictObject({
  query: z.string().trim().max(200).default(''),
  limit: z.number().int().min(1).max(100).default(20),
});
const getValuationInput = z.strictObject({ cardVariantId: idSchema });

export function createTools({ aggregatorService, valuationService, tradingService, paymentService }: ToolServices): ToolDefinition[] {
  const tools = [
    defineTool({
      name: 'search_cards',
      description: '카드 이름으로 카드 variant를 검색합니다. 결과의 id를 get_valuation에 넘길 수 있습니다.',
      inputSchema: searchCardsInput,
      annotations: readOnly,
      run: async ({ query, limit }) =>
        cardSearchResponseSchema.parse({ items: await aggregatorService.searchCards({ query, limit }), nextCursor: null }),
    }),
    defineTool({
      name: 'get_valuation',
      description:
        '카드 variant ID로 적정가, 표본 수, 신뢰 수준, 데이터 출처를 조회합니다. 표본이 없으면 status가 INSUFFICIENT_DATA이고 estimatedPrice는 null입니다.',
      inputSchema: getValuationInput,
      annotations: readOnly,
      run: async ({ cardVariantId }) => valuationSchema.parse(await valuationService.getValuation(cardVariantId)),
    }),
  ];
  if (tradingService) {
    const trading = tradingService;
    const buyer = (context: ToolContext): TradingBuyer => {
      if (!context.auth) throw new AppError('UNAUTHORIZED', '인증이 필요합니다.', 401);
      if (!context.auth.agentId) throw new AppError('FORBIDDEN', '인증된 Agent가 필요합니다.', 403);
      return { userId: context.auth.userId, agentId: context.auth.agentId };
    };
    const mutation = (context: ToolContext) => {
      const result = mutationContextSchema.safeParse({ idempotencyKey: context.requestKey });
      if (!result.success) throw new AppError('VALIDATION_ERROR', '서버 실행 계층의 안정적인 요청 키가 필요합니다.');
      return result.data;
    };
    const add = <S extends z.ZodObject>(name: string, inputSchema: S, run: (args: z.output<S>, context: ToolContext) => Promise<unknown>, readonly = false) => tools.push(defineTool({ name, inputSchema, run, description: name.replaceAll('_', ' '), annotations: { readOnlyHint: readonly, openWorldHint: false } }));
    add('list_listings', listingQuerySchema.strict(), (args) => trading.listListings(args), true);
    add('get_listing', z.strictObject({ listingId: idSchema }), ({ listingId }) => trading.getListing(listingId), true);
    add('create_buy_order', createBuyOrderInputSchema.strict(), (args, context) => trading.createBuyOrder(buyer(context), args, mutation(context)));
    add('list_buy_orders', z.strictObject({}), (_args, context) => trading.listBuyOrders(buyer(context)), true);
    add('cancel_buy_order', z.strictObject({ buyOrderId: idSchema }), ({ buyOrderId }, context) => trading.cancelBuyOrder(buyer(context), buyOrderId));
    add('match_buy_order', z.strictObject({ buyOrderId: idSchema }), ({ buyOrderId }, context) => trading.matchBuyOrder(buyer(context), buyOrderId, mutation(context)));
    add('quote_fixed_purchase', fixedPurchaseInputSchema.strict(), (args, context) => trading.quoteFixedPurchase(buyer(context), args, mutation(context)));
    add('quote_market_purchase', marketPurchaseInputSchema.strict(), (args, context) => trading.quoteMarketPurchase(buyer(context), args, mutation(context)));
    add('get_purchase_status', z.strictObject({ matchQuoteId: idSchema }), ({ matchQuoteId }, context) => paymentService ? paymentService.getPaymentStatus(matchQuoteId, buyer(context)) : trading.getMatch(buyer(context), matchQuoteId), true);
    add('execute_purchase', z.strictObject({ matchQuoteId: idSchema }), async ({ matchQuoteId }, context) => {
      const auth = buyer(context);
      if (!paymentService) throw new AppError('PAYMENT_UNAVAILABLE', '결제 제공자가 없습니다.', 503);
      if (context.paymentPayload !== undefined) return paymentService.processSignedPayment({ matchQuoteId, agentId: auth.agentId, paymentPayload: context.paymentPayload }, auth);
      const status = await paymentService.getPaymentStatus(matchQuoteId, auth);
      if (status.paymentStatus && status.paymentStatus !== 'REQUIRED') return status;
      const payment = await paymentService.preparePayment({ matchQuoteId, agentId: auth.agentId }, auth);
      throw new PaymentChallenge({ x402Version: 2, error: 'Payment required', resource: { url: `mcp://tool/execute_purchase/${matchQuoteId}`, mimeType: 'application/json' }, accepts: [payment.requirements] });
    });
  }
  return tools;
}

export class PaymentChallenge extends Error { constructor(public readonly data: Record<string, unknown>) { super("Payment required"); } }
