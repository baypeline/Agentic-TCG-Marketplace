import { AppError, spendingPolicySchema, type TradingBuyer, type TradingExecutionContextReader, type ValuationService } from '@tcg/contracts';

export async function assertTradingExecution({ buyer, cardVariantId, amount, time, executionContext, valuationService, checkDiscount = true }: {
  buyer: TradingBuyer;
  cardVariantId: string;
  amount: string;
  time: Date;
  executionContext?: TradingExecutionContextReader;
  valuationService?: ValuationService;
  checkDiscount?: boolean;
}) {
  const context = await executionContext?.getExecutionContext(buyer);
  const parsed = spendingPolicySchema.safeParse(context?.policy);
  if (!context || context.online !== true || !parsed.success || parsed.data.agentId !== buyer.agentId || !parsed.data.enabled || new Date(parsed.data.validUntil) <= time) {
    throw new AppError('POLICY_VIOLATION', '활성 Agent와 유효한 사전 승인 정책이 필요합니다.', 409);
  }
  const policy = parsed.data;
  if (policy.allowedCardVariantIds && !policy.allowedCardVariantIds.includes(cardVariantId)) {
    throw new AppError('POLICY_VIOLATION', '정책에서 허용하지 않은 카드입니다.', 409);
  }
  if (BigInt(amount) > BigInt(policy.maxPerTrade) || BigInt(amount) > BigInt(context.availableBudget ?? policy.totalBudget)) {
    throw new AppError('BUDGET_EXCEEDED', '사전 승인된 구매 한도를 초과합니다.', 409);
  }
  if (checkDiscount && policy.minDiscountPercent && policy.minDiscountPercent > 0) {
    const value = await valuationService?.getValuation(cardVariantId);
    if (!value || value.status !== 'AVAILABLE' || value.dataSource !== 'MARKET') {
      throw new AppError('POLICY_VIOLATION', '할인 조건을 검증할 실제 적정가가 필요합니다.', 409);
    }
    // 백만분의 1 퍼센트로 올림하여 부동소수점 오차가 구매 허용으로 이어지지 않게 한다.
    const discount = BigInt(Math.ceil(policy.minDiscountPercent * 1_000_000));
    if (BigInt(amount) * 100_000_000n > BigInt(value.estimatedPrice) * (100_000_000n - discount)) {
      throw new AppError('POLICY_VIOLATION', '정책의 최소 할인율을 충족하지 않습니다.', 409);
    }
  }
  return policy;
}
