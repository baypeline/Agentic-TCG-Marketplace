import { createHash, randomUUID } from 'node:crypto';
import { PaymentPayloadV2Schema } from '@x402/core/schemas';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { AppError, tradingBuyerSchema, idSchema, purchaseStatusSchema, type TradingBuyer, type ValuationService } from '@tcg/contracts';
import { assertTradingExecution, type TradingStore, type TradingService, type PaymentRow, type TradingTransaction } from '@tcg/trading';
import { getPolicyExecutionContext, ownedPolicy } from './policies.js';

export interface SettlementOutcome { status: 'SETTLED' | 'FAILED' | 'UNKNOWN'; transactionHash?: string; definitive?: boolean }
export interface SettlementAdapter {
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<{ valid: boolean }>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettlementOutcome>;
  // 반드시 기존 증빙만 조회한다. 새 settle이나 새 서명을 수행하지 않는다.
  reconcile(attempt: Readonly<PaymentRow>): Promise<SettlementOutcome>;
}
export interface PaymentServiceOptions {
  store: TradingStore;
  tradingService: TradingService;
  valuationService?: ValuationService;
  adapter?: SettlementAdapter;
  recipient?: string;
  getWalletAddress?: (auth: TradingBuyer) => Promise<string | null>;
  now?: () => Date;
  reviewAfterMs?: number;
}
const address = /^0x[0-9a-fA-F]{40}$/;
const asset = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
export function createPaymentEvidenceReader(store: TradingStore) {
  return { async getPaymentRecord(id: string) {
    return store.transaction(async tx => { const row = await tx.payments.get(id); return row ? { paymentAttemptId: row.id, matchQuoteId: row.matchQuoteId, amount: row.amount, currency: 'USDC' as const, status: row.status as 'REQUIRED' | 'PENDING' | 'UNKNOWN' | 'FAILED' | 'SETTLED' } : null; });
  } };
}
export function createPaymentService({ store, tradingService, valuationService, adapter, recipient, getWalletAddress, now = () => new Date(), reviewAfterMs = 300_000 }: PaymentServiceOptions) {
  async function quoteFor(tx: TradingTransaction, auth: TradingBuyer, id: string) {
    const quote = await tx.quotes.get(idSchema.parse(id));
    if (!quote) throw new AppError('QUOTE_EXPIRED', '예약을 찾을 수 없습니다.', 404);
    if (quote.buyerId !== auth.userId || quote.buyerAgentId !== auth.agentId) throw new AppError('FORBIDDEN', '예약에 접근할 수 없습니다.', 403);
    return quote;
  }
  async function validateSubmission(tx: TradingTransaction, auth: TradingBuyer, id: string) {
    const quote = await quoteFor(tx, auth, id);
    if (quote.status !== 'RESERVED' || quote.expiresAt <= now()) throw new AppError('QUOTE_EXPIRED', '결제할 수 없는 예약입니다.', 409);
    const listing = await tx.listings.get(quote.listingId);
    if (!listing || listing.status !== 'RESERVED') throw new AppError('LISTING_UNAVAILABLE', '예약된 매물이 없습니다.', 409);
    if (quote.buyOrderId && (await tx.orders.get(quote.buyOrderId))?.status === 'PAUSED') throw new AppError('POLICY_VIOLATION', '주문이 일시 중지됐습니다.', 409);
    if (!quote.policyId) throw new AppError('POLICY_VIOLATION', '예약의 승인 정책을 확인할 수 없습니다.', 409);
    const policy = await assertTradingExecution({ buyer: auth, cardVariantId: listing.cardVariantId, amount: quote.amount, time: now(), valuationService,
      executionContext: { getExecutionContext: buyer => getPolicyExecutionContext(tx, buyer, now(), quote.policyId) } });
    return { quote, policy };
  }
  async function finishTrade(row: PaymentRow) {
    if (row.status === 'SETTLED') {
      try { await tradingService.finalizeTrade(row.matchQuoteId, row.id); }
      catch { /* SETTLED remains durable; the recovery worker only retries the trade. */ }
    }
    if (row.status === 'FAILED') await tradingService.releaseFailedPayment(row.matchQuoteId, row.id);
  }
  async function applyOutcome(id: string, outcome: SettlementOutcome) {
    const row = await store.transaction(async tx => {
      const row = await tx.payments.get(id);
      if (!row) throw new AppError('PAYMENT_REQUIRED', '결제 시도를 찾을 수 없습니다.', 404);
      if (row.status === 'SETTLED' || row.status === 'FAILED') return row;
      if (row.status !== 'PENDING' && row.status !== 'UNKNOWN') return row;
      const status = (outcome.status === 'FAILED' && !outcome.definitive) || (outcome.status === 'SETTLED' && !/^0x[0-9a-fA-F]{64}$/.test(outcome.transactionHash ?? '')) ? 'UNKNOWN' : outcome.status;
      const updated = { ...row, status, transactionHash: outcome.transactionHash ?? row.transactionHash, updatedAt: now(), needsReview: status === 'UNKNOWN' && !!row.submittedAt && now().getTime() - row.submittedAt.getTime() >= reviewAfterMs };
      if (status === 'SETTLED' || status === 'FAILED') {
        const policy = await tx.policies.get(row.policyId);
        if (!policy || BigInt(policy.reservedAmount) < BigInt(row.amount)) throw new AppError('INTERNAL_ERROR', '예산 예약 증빙을 확인할 수 없습니다.', 500);
        await tx.policies.replace({ ...policy, reservedAmount: (BigInt(policy.reservedAmount)-BigInt(row.amount)).toString(), spentAmount: (BigInt(policy.spentAmount)+(status === 'SETTLED' ? BigInt(row.amount) : 0n)).toString() }, { version: policy.version, reservedAmount: policy.reservedAmount, spentAmount: policy.spentAmount });
      }
      await tx.payments.replace(updated, { status: row.status });
      if (status === 'SETTLED' || status === 'UNKNOWN') {
        const quote = await tx.quotes.get(row.matchQuoteId);
        if (quote && (quote.status === 'PAYMENT_PENDING' || quote.status === 'RECONCILING')) await tx.quotes.replace({ ...quote, status: status === 'SETTLED' ? 'SETTLED' : 'RECONCILING' }, { status: quote.status });
      }
      return updated;
    });
    await finishTrade(row);
    return row;
  }
  const service = {
    async preparePayment(input: { matchQuoteId: string; agentId: string }, auth: TradingBuyer) {
      auth = tradingBuyerSchema.parse(auth);
      if (input.agentId !== auth.agentId) throw new AppError('FORBIDDEN', 'Agent가 일치하지 않습니다.', 403);
      if (!adapter || !recipient || !address.test(recipient) || !getWalletAddress) throw new AppError('PAYMENT_UNAVAILABLE', '검증된 결제 제공자와 지갑 연결이 필요합니다.', 503);
      return store.transaction(async tx => {
        const { quote, policy } = await validateSubmission(tx, auth, input.matchQuoteId);
        const existing = (await tx.payments.find({ matchQuoteId: quote.id }))[0];
        if (existing && existing.status !== 'REQUIRED') throw new AppError('PAYMENT_UNKNOWN', '기존 결제 상태를 확인하세요. 새 지급을 만들 수 없습니다.', 409);
        if (existing) return { id: existing.id, matchQuoteId: quote.id, requirements: JSON.parse(existing.requirementsJson) as PaymentRequirements };
        const requirements: PaymentRequirements = { scheme: 'exact', network: 'eip155:84532', asset, amount: quote.amount, payTo: recipient, maxTimeoutSeconds: Math.max(1,Math.min(60,Math.floor((quote.expiresAt.getTime()-now().getTime())/1000))), extra: { name: 'USDC', version: '2', tcgQuoteId: quote.id } };
        const row: PaymentRow = { id: randomUUID(), matchQuoteId: quote.id, userId: auth.userId, agentId: auth.agentId, policyId: policy.id, policyVersion: policy.version, amount: quote.amount, status: 'REQUIRED', requirementsJson: JSON.stringify(requirements), payloadHash: null, transactionHash: null, submittedAt: null, updatedAt: now(), needsReview: false };
        await tx.payments.insert(row);
        return { id: row.id, matchQuoteId: quote.id, requirements };
      });
    },
    async processSignedPayment(input: { matchQuoteId: string; agentId: string; paymentPayload: unknown }, auth: TradingBuyer) {
      auth = tradingBuyerSchema.parse(auth);
      if (input.agentId !== auth.agentId) throw new AppError('FORBIDDEN', 'Agent가 일치하지 않습니다.', 403);
      const initial = await store.transaction(async tx => { await quoteFor(tx, auth, input.matchQuoteId); return (await tx.payments.find({ matchQuoteId: input.matchQuoteId }))[0]; });
      if (!initial) throw new AppError('PAYMENT_REQUIRED', '서버 결제 요구를 먼저 발행해야 합니다.', 409);
      if (initial.status !== 'REQUIRED') { await finishTrade(initial); return service.getPaymentStatus(input.matchQuoteId, auth); }
      if (!adapter || !getWalletAddress) throw new AppError('PAYMENT_UNAVAILABLE', '결제 제공자가 연결되지 않았습니다.', 503);
      const parsed = PaymentPayloadV2Schema.safeParse(input.paymentPayload);
      if (!parsed.success) throw new AppError('VALIDATION_ERROR', 'x402 지급 승인 형식을 확인하세요.');
      const payload = parsed.data as PaymentPayload;
      const requirements = JSON.parse(initial.requirementsJson) as PaymentRequirements;
      const authorization = payload.payload.authorization as { from?: string; to?: string; value?: string } | undefined;
      const wallet = await getWalletAddress(auth);
      if (!wallet || !address.test(wallet) || !authorization || authorization.from?.toLowerCase() !== wallet.toLowerCase() || authorization.to?.toLowerCase() !== requirements.payTo.toLowerCase() || authorization.value !== requirements.amount ||
        payload.accepted.amount !== requirements.amount || payload.accepted.network !== requirements.network || payload.accepted.scheme !== requirements.scheme || payload.accepted.asset.toLowerCase() !== requirements.asset.toLowerCase() || payload.accepted.payTo.toLowerCase() !== requirements.payTo.toLowerCase()) {
        throw new AppError('PAYMENT_FAILED', '승인된 Agent 지갑과 서버 결제 요구에 일치하는 지급이 필요합니다.', 409);
      }
      let valid = false;
      try { valid = (await adapter.verify(payload, requirements)).valid; } catch { throw new AppError('PAYMENT_UNAVAILABLE', '지급 승인 검증에 연결하지 못했습니다.', 503, true); }
      if (!valid) throw new AppError('PAYMENT_FAILED', '지급 승인을 검증하지 못했습니다.', 409);
      const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const approved = await store.transaction(async tx => {
        const current = await tx.payments.get(initial.id);
        if (!current) throw new AppError('PAYMENT_REQUIRED', '결제 시도를 찾을 수 없습니다.', 404);
        if (current.status !== 'REQUIRED') return false;
        const { quote, policy } = await validateSubmission(tx, auth, input.matchQuoteId);
        const ledger = await ownedPolicy(tx, auth, policy.id);
        await tx.policies.replace({ ...ledger, reservedAmount: (BigInt(ledger.reservedAmount)+BigInt(quote.amount)).toString() }, { version: ledger.version, reservedAmount: ledger.reservedAmount, spentAmount: ledger.spentAmount });
        await tx.payments.replace({ ...current, policyId: policy.id, policyVersion: policy.version, payloadHash, submittedAt: now(), updatedAt: now(), status: 'PENDING' }, { status: 'REQUIRED' });
        await tx.quotes.replace({ ...quote, status: 'PAYMENT_PENDING', paymentAttemptId: current.id }, { status: 'RESERVED', paymentAttemptId: null });
        return true;
      });
      if (approved) {
        let outcome: SettlementOutcome;
        try { outcome = await adapter.settle(payload, requirements); } catch { outcome = { status: 'UNKNOWN' }; }
        await applyOutcome(initial.id, outcome);
      }
      return service.getPaymentStatus(input.matchQuoteId, auth);
    },
    async getPaymentStatus(matchQuoteId: string, auth: TradingBuyer) {
      auth = tradingBuyerSchema.parse(auth);
      const match = await tradingService.getMatch(auth, matchQuoteId);
      return store.transaction(async tx => {
        const quote = await quoteFor(tx, auth, matchQuoteId);
        const row = (await tx.payments.find({ matchQuoteId }))[0];
        const [trade] = await tx.trades.find({ matchQuoteId });
        return purchaseStatusSchema.parse({ id: quote.id, paymentAttemptId: row?.id ?? null, policyId: row?.policyId ?? quote.policyId, policyVersion: row?.policyVersion ?? null, amount: quote.amount, quoteStatus: quote.status,
          paymentStatus: row?.status ?? null, tradeStatus: trade ? 'COMPLETED' : row?.status === 'SETTLED' ? 'FINALIZING' : 'NOT_STARTED',
          holdReasons: match.holdReasons, expiresAt: quote.expiresAt.toISOString(), remainingMs: match.remainingMs, transactionHash: row?.transactionHash ?? null, needsReview: !trade && (!!row?.needsReview || (row?.status === 'SETTLED' && now().getTime() - row.updatedAt.getTime() >= reviewAfterMs)),
          retryPaymentAllowed: quote.status === 'RESERVED' && match.holdReasons.length === 0 && (!row || row.status === 'REQUIRED') });
      });
    },
    async recover() {
      const rows = await store.transaction(async tx => (await tx.payments.find({})).filter(row => ['PENDING','UNKNOWN','SETTLED','FAILED'].includes(row.status)));
      for (const row of rows) {
        if (row.status === 'SETTLED' || row.status === 'FAILED') { await finishTrade(row); continue; }
        let result: SettlementOutcome = { status: 'UNKNOWN' };
        try { if (adapter) result = await adapter.reconcile(row); } catch { /* retain protected unknown */ }
        await applyOutcome(row.id, result);
      }
    },
  };
  return service;
}
export type PaymentService = ReturnType<typeof createPaymentService>;
