import Fastify from 'fastify';
import { expect, it } from 'vitest';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { createX402SettlementAdapter } from '../src/adapter.js';

it('자체 퍼실리테이터에 인증 헤더와 x402 요청을 전달한다', async () => {
  const app = Fastify(); const seen: string[] = [];
  const token = 'local-token-'.repeat(4), payer = `0x${'1'.repeat(40)}`;
  for (const path of ['verify', 'settle']) app.post(`/${path}`, async request => {
    expect(request.headers.authorization).toBe(`Bearer ${token}`);
    expect(request.body).toMatchObject({ x402Version: 2, paymentRequirements: { amount: '1000' } });
    seen.push(path);
    return path === 'verify' ? { isValid: true, payer } : { success: true, payer, network: 'eip155:84532', transaction: `0x${'a'.repeat(64)}` };
  });
  const url = await app.listen({ host: '127.0.0.1', port: 0 });
  try {
    const adapter = createX402SettlementAdapter({ getWalletAddress: async () => payer, facilitatorUrl: url, facilitatorToken: token });
    const requirements: PaymentRequirements = { scheme: 'exact', network: 'eip155:84532', amount: '1000', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', payTo: `0x${'2'.repeat(40)}`, maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } };
    const payload: PaymentPayload = { x402Version: 2, accepted: requirements, payload: {} };
    expect(await adapter.verify(payload, requirements)).toEqual({ valid: true });
    expect(await adapter.settle(payload, requirements)).toMatchObject({ status: 'SETTLED', transactionHash: `0x${'a'.repeat(64)}` });
    expect(seen).toEqual(['verify', 'settle']);
  } finally { await app.close(); }
});
