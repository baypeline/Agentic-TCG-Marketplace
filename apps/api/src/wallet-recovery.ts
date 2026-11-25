import type { SettlementAdapter } from '@tcg/payment-server';

/** 지갑 모드 변경 전에 제출된 지급도 보존한 지갑 주소로 증빙만 조회한다. */
export function withPreviousWalletRecovery(active: SettlementAdapter, previous?: SettlementAdapter): SettlementAdapter {
  return {
    verify: (payload, requirements) => active.verify(payload, requirements),
    settle: (payload, requirements) => active.settle(payload, requirements),
    async reconcile(attempt) {
      const result = await active.reconcile(attempt);
      return result.status === 'UNKNOWN' && previous ? previous.reconcile(attempt) : result;
    },
  };
}
