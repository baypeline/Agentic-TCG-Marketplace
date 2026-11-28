import { randomUUID } from 'node:crypto';
import { AppError, agentBudgetPatchSchema, agentBudgetProposalSchema, type AgentBudgetProposal } from '@tcg/contracts';
import { getPaymentProfile } from '@tcg/contracts/payment-profile';
import type { ApiEnv } from '@tcg/config';
import type { PolicyService } from '@tcg/payment-server';
import type { AgentSessionPluginOptions } from '@tcg/agent';
import { ensureDemoPurchasePolicy } from './demo-purchase.js';
import { demoBuyerId, demoBuyerAgentId } from './demo-auth.js';

export function createAgentBudgetHandler(env: ApiEnv, policies: PolicyService, now = () => new Date()): NonNullable<AgentSessionPluginOptions['budget']> {
  const profile = getPaymentProfile(env.PAYMENT_CHAIN);
  const buyer = { userId: demoBuyerId, agentId: demoBuyerAgentId };
  function units(value: string) {
    const [whole, fraction = ''] = value.split('.');
    if (fraction.length > profile.decimals) throw new AppError('VALIDATION_ERROR', `소수점은 ${profile.decimals}자리까지 입력해 주세요.`, 400);
    const amount = BigInt(whole!) * 10n ** BigInt(profile.decimals) + BigInt(fraction.padEnd(profile.decimals, '0'));
    if (amount <= 0n) throw new AppError('VALIDATION_ERROR', '예산과 건당 한도는 0보다 커야 합니다.', 400);
    return amount.toString();
  }
  function validate(total: string, per: string, spent: string, reserved: string) {
    if (BigInt(per) > BigInt(profile.maxPerTrade)) throw new AppError('POLICY_VIOLATION', `서버 서명기의 건당 상한을 초과했습니다. 현재 최대 ${env.PAYMENT_CHAIN === 'maroo' ? '25 tOKRW' : '0.025 USDC'}입니다.`, 409);
    if (BigInt(per) > BigInt(total)) throw new AppError('VALIDATION_ERROR', '건당 한도는 총예산 이하이어야 합니다. 함께 낮출 건당 한도도 알려주세요.', 400);
    if (BigInt(total) < BigInt(spent) + BigInt(reserved)) throw new AppError('BUDGET_EXCEEDED', '총예산을 사용 완료액과 결제 예약액의 합계보다 낮출 수 없습니다.', 409);
  }
  return {
    async propose(patch) {
      patch = agentBudgetPatchSchema.parse(patch);
      if (patch.currency !== profile.currency) throw new AppError('VALIDATION_ERROR', `현재 예산 통화는 ${profile.currency}입니다. 다른 통화로 자동 환산하지 않습니다.`, 400);
      const total = patch.totalBudget === null ? null : units(patch.totalBudget);
      const per = patch.maxPerTrade === null ? null : units(patch.maxPerTrade);
      const initial = await ensureDemoPurchasePolicy(env, policies);
      const policy = await policies.get(buyer, initial.id);
      const budget = await policies.budget(buyer, policy.id);
      const totalBudget = total ?? policy.totalBudget, maxPerTrade = per ?? policy.maxPerTrade;
      validate(totalBudget, maxPerTrade, budget.spentAmount, budget.reservedAmount);
      return agentBudgetProposalSchema.parse({ id: randomUUID(), policyId: policy.id, expectedVersion: policy.version, currency: profile.currency, previousTotalBudget: policy.totalBudget, previousMaxPerTrade: policy.maxPerTrade, totalBudget, maxPerTrade, spentAmount: budget.spentAmount, reservedAmount: budget.reservedAmount, availableAmount: (BigInt(totalBudget) - BigInt(budget.spentAmount) - BigInt(budget.reservedAmount)).toString(), signerMaxPerTrade: profile.maxPerTrade, expiresAt: new Date(now().getTime() + 5 * 60_000).toISOString() });
    },
    async confirm(proposal: AgentBudgetProposal) {
      if (new Date(proposal.expiresAt) <= now()) throw new AppError('POLICY_VIOLATION', '변경안이 만료되었습니다. 예산 변경을 다시 요청해 주세요.', 409);
      const current = await policies.get(buyer, proposal.policyId);
      const budget = await policies.budget(buyer, current.id);
      validate(proposal.totalBudget, proposal.maxPerTrade, budget.spentAmount, budget.reservedAmount);
      const { id: _, version: __, agentId: ___, ...fields } = current;
      const policy = await policies.update(buyer, current.id, { ...fields, totalBudget: proposal.totalBudget, maxPerTrade: proposal.maxPerTrade, expectedVersion: proposal.expectedVersion }, { idempotencyKey: `chat-budget:${proposal.id}` });
      return { proposalId: proposal.id, status: 'APPLIED', currency: profile.currency, policy, budget: await policies.budget(buyer, policy.id) };
    },
  };
}
