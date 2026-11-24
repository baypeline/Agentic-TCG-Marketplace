import { afterEach, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toHex } from 'viem';
import type { AgentPurchaseOffer, AgentPurchaseProgress } from '@tcg/contracts';
import { demoCards } from '@tcg/contracts/fixtures';
import { connectPaymentWallet, walletErrorMessage } from '../src/features/chat/wallet-payment';

afterEach(() => { vi.unstubAllGlobals(); });
const recipient = `0x${'1'.repeat(40)}`;
const offer: AgentPurchaseOffer = { listingId: '00000000-0000-4000-8200-000000000001', card: demoCards[0]!, price: '10000', dataSource: 'SYNTHETIC_DEMO', paymentMode: 'X402_BASE_SEPOLIA', paymentReady: true };
function fixture(balance = 1000000n) {
  const account = privateKeyToAccount(generatePrivateKey());
  const request = vi.fn(async ({ method, params }: { method: string; params?: unknown[] }) => {
    if (method === 'eth_requestAccounts') return [account.address];
    if (method === 'eth_chainId') return toHex(84532);
    if (method === 'eth_call') return toHex(balance, { size: 32 });
    if (method === 'eth_signTypedData_v4') return account.signTypedData(JSON.parse(String(params?.[1])));
    throw new Error(`예상하지 못한 지갑 호출: ${method}`);
  });
  vi.stubGlobal('window', { ethereum: { request } });
  const prepared: AgentPurchaseProgress = { requestId: '00000000-0000-4000-8200-000000000002', listingId: offer.listingId, card: offer.card, amount: offer.price, matchQuoteId: '00000000-0000-4000-8200-000000000003', status: 'PAYMENT_REQUIRED', paymentMode: 'X402_BASE_SEPOLIA', expiresAt: '2099-01-01T00:00:00Z', payer: account.address, recipient, requirements: { scheme: 'exact', network: 'eip155:84532', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', amount: offer.price, payTo: recipient, maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } } };
  return { account, request, prepared };
}

it('브라우저 지갑의 EIP-712 서명으로 x402 지급 승인을 만들며 직접 송금하지 않는다', async () => {
  const f = fixture(); const wallet = await connectPaymentWallet();
  const payload = await wallet.sign(f.prepared, offer);
  expect(payload.accepted.amount).toBe('10000');
  expect(payload.accepted.payTo).toBe(recipient);
  expect(payload.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
  expect(f.request.mock.calls.some(([input]) => input.method === 'eth_signTypedData_v4')).toBe(true);
  expect(f.request.mock.calls.some(([input]) => input.method === 'eth_sendTransaction')).toBe(false);
});

it('잘못 선택한 구매 지갑과 잔액 부족에서는 지급 서명을 요청하지 않는다', async () => {
  const f = fixture(0n); const wallet = await connectPaymentWallet();
  await expect(wallet.sign({ ...f.prepared, payer: recipient }, offer)).rejects.toThrow('구매자 지갑');
  await expect(wallet.sign(f.prepared, offer)).rejects.toThrow('잔액이 부족');
  expect(f.request.mock.calls.some(([input]) => input.method === 'eth_signTypedData_v4')).toBe(false);
});

it('지갑의 중첩된 사용자 거절을 읽기 쉬운 안내로 표시한다', () => {
  expect(walletErrorMessage({ cause: { code: 4001 } })).toContain('취소했어요');
});
