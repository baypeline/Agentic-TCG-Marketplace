import { expect, it, vi } from 'vitest';
import type { SettlementAdapter } from '@tcg/payment-server';
import { withPreviousWalletRecovery } from '../src/wallet-recovery.js';

it('지갑 모드 변경 후에도 이전 지갑 증빙을 조회하며 재정산하지 않는다', async () => {
  const current = { verify: vi.fn(), settle: vi.fn(), reconcile: vi.fn(async () => ({ status: 'UNKNOWN' as const })) };
  const previous = { verify: vi.fn(), settle: vi.fn(), reconcile: vi.fn(async () => ({ status: 'SETTLED' as const, transactionHash: `0x${'a'.repeat(64)}` })) };
  const adapter = withPreviousWalletRecovery(current, previous);
  const attempt = {} as Parameters<SettlementAdapter['reconcile']>[0];
  expect((await adapter.reconcile(attempt)).status).toBe('SETTLED');
  expect(previous.reconcile).toHaveBeenCalledWith(attempt);
  expect(current.settle).not.toHaveBeenCalled();
  expect(previous.settle).not.toHaveBeenCalled();
  expect(previous.verify).not.toHaveBeenCalled();
});

it('현재 지갑의 정산 확인 결과가 확정이면 이전 지갑을 조회하지 않는다', async () => {
  const current = { verify: vi.fn(), settle: vi.fn(), reconcile: vi.fn(async () => ({ status: 'SETTLED' as const })) };
  const previous = { verify: vi.fn(), settle: vi.fn(), reconcile: vi.fn() };
  const adapter = withPreviousWalletRecovery(current, previous);
  await adapter.reconcile({} as Parameters<SettlementAdapter['reconcile']>[0]);
  expect(previous.reconcile).not.toHaveBeenCalled();
});
