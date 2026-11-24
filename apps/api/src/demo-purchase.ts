import { z } from 'zod';
import { AppError, agentPaymentRequirementsSchema, agentPurchaseProgressSchema, errorCodeSchema, matchQuoteSchema, purchaseStatusSchema, type AgentPurchaseProgress } from '@tcg/contracts';
import { createServerMcpClient, type AgentSessionPluginOptions } from '@tcg/agent';
import type { PolicyService } from '@tcg/payment-server';
import type { TradingService } from '@tcg/trading';
import type { ApiEnv } from '@tcg/config';
import { readDemoScenarios } from '@tcg/db';
import { demoBuyerId, demoBuyerAgentId } from './demo-auth.js';

type ToolResult = Awaited<ReturnType<ReturnType<typeof createServerMcpClient>['call']>>;
function data<T>(result: ToolResult, schema: z.ZodType<T>): T {
  const parsed = z.object({ ok: z.literal(true), data: schema }).safeParse(result.structuredContent);
  if (parsed.success) return parsed.data.data;
  const error = z.object({ error: z.object({ code: errorCodeSchema, message: z.string(), retryable: z.boolean() }) }).safeParse(result.structuredContent);
  if (error.success) throw new AppError(error.data.error.code, error.data.error.message, 409, error.data.error.retryable);
  throw new AppError('INTERNAL_ERROR', 'MCP 거래 응답을 확인하지 못했습니다.', 502);
}

/** 정책·예산·소유권·정산은 각 모듈에 맡기고 승인된 구매의 MCP 호출만 조립한다. */
export function createDemoPurchaseHandler({ env, trading, policies, getMcpUrl }: {
  env: ApiEnv; trading: TradingService; policies: PolicyService; getMcpUrl(): string;
}): NonNullable<AgentSessionPluginOptions['purchase']> {
  return async input => {
    if (!env.DEMO_SCENARIOS_ENABLED || !env.PAYMENT_ENABLED || !env.DEMO_BUYER_TOKEN || !env.PAYMENT_RECIPIENT || !env.AGENT_WALLET_ADDRESS) throw new AppError('PAYMENT_UNAVAILABLE', '결제 지갑과 테스트넷 연결 설정이 필요합니다.', 503);
    const pack = await readDemoScenarios();
    if (!pack.scenarios.some(scene => scene.cardId === input.offer.card.id)) throw new AppError('FORBIDDEN', '시나리오 데모 카드만 구매할 수 있습니다.', 403);
    const buyer = { userId: demoBuyerId, agentId: demoBuyerAgentId };
    const policy = await policies.create(buyer, { enabled: true, totalBudget: '100000', maxPerTrade: '25000', allowedCardVariantIds: pack.scenarios.map(scene => scene.cardId), validUntil: '2099-01-01T00:00:00.000Z' }, { idempotencyKey: 'scenario-demo-policy-v1' });
    const key = `${input.sessionId}:${input.requestId}`;
    const run = await policies.startRun(buyer, { policyId: policy.id, instruction: `${input.offer.card.name} 구매 · 사용자 확인 ${input.requestId}` }, { idempotencyKey: `scenario-run:${key}` });
    const mcp = createServerMcpClient({ url: getMcpUrl(), headers: { authorization: `Bearer ${env.DEMO_BUYER_TOKEN}` }, keyFor: (action, args) => policies.actionKey(buyer, run.id, action, args) });
    let quote;
    try { quote = data(await mcp.call('quote_fixed_purchase', { listingId: input.offer.listingId, maxPrice: input.offer.price }, 'quote'), matchQuoteSchema); }
    catch (error) { await policies.stopRun(buyer, run.id).catch(() => undefined); throw error; }
    const base = { requestId: input.requestId, listingId: input.offer.listingId, card: input.offer.card, amount: quote.amount, matchQuoteId: quote.id, expiresAt: quote.expiresAt, paymentMode: 'X402_BASE_SEPOLIA' as const, payer: env.AGENT_WALLET_ADDRESS, recipient: env.PAYMENT_RECIPIENT };
    if (input.action === 'cancel') {
      await trading.releaseQuote(buyer, quote.id);
      await policies.stopRun(buyer, run.id);
      return agentPurchaseProgressSchema.parse({ ...base, status: 'CANCELLED' });
    }
    let status;
    if (input.action === 'prepare') {
      try {
        const result = await mcp.call('execute_purchase', { matchQuoteId: quote.id }, 'payment-requirements');
        const challenge = z.object({ x402Version: z.literal(2), accepts: z.array(agentPaymentRequirementsSchema).min(1) }).safeParse(result.structuredContent);
        if (result.isError && challenge.success) {
          const requirements = challenge.data.accepts[0]!;
          if (requirements.amount !== input.offer.price || requirements.payTo.toLowerCase() !== env.PAYMENT_RECIPIENT.toLowerCase()) throw new AppError('PAYMENT_FAILED', '결제 금액이나 수납 주소가 매물과 일치하지 않습니다.', 409);
          return agentPurchaseProgressSchema.parse({ ...base, status: 'PAYMENT_REQUIRED', requirements });
        }
        status = data(result, purchaseStatusSchema);
      } catch (error) {
        await trading.releaseQuote(buyer, quote.id).catch(() => undefined);
        await policies.stopRun(buyer, run.id).catch(() => undefined);
        throw error;
      }
    } else if (input.action === 'submit') {
      if (!input.paymentPayload) throw new AppError('VALIDATION_ERROR', '지갑의 지급 서명이 필요합니다.', 400);
      status = data(await mcp.call('execute_purchase', { matchQuoteId: quote.id }, 'payment-submit', input.paymentPayload), purchaseStatusSchema);
    } else {
      status = data(await mcp.call('get_purchase_status', { matchQuoteId: quote.id }, 'payment-status'), purchaseStatusSchema);
    }
    let progress: AgentPurchaseProgress['status'] = 'PENDING';
    let tradeId: string | undefined;
    if (status.tradeStatus === 'COMPLETED' && status.paymentStatus === 'SETTLED') {
      const trade = (await trading.listTrades(buyer)).find(item => item.matchQuoteId === quote.id);
      if (!trade) throw new AppError('INTERNAL_ERROR', '체결 내역을 확인하지 못했습니다.', 500);
      progress = 'COMPLETED'; tradeId = trade.id;
      await policies.recordResult(buyer, run.id, `${input.offer.card.name} 구매 완료 · Trade ${trade.id}`, true);
    } else if (status.paymentStatus === 'FAILED') { progress = 'FAILED'; await policies.failRun(buyer, run.id); }
    else if (status.quoteStatus === 'RELEASED') { progress = 'CANCELLED'; await policies.stopRun(buyer, run.id); }
    return agentPurchaseProgressSchema.parse({ ...base, status: progress, ...(tradeId ? { tradeId } : {}), ...(status.transactionHash ? { transactionHash: status.transactionHash } : {}) });
  };
}
