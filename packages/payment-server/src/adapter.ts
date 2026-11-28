import { getPaymentProfile, type PaymentChain } from '@tcg/contracts/payment-profile';
import { marooTestnet, nativePaymentData } from '@tcg/payment-client/native';
import { rwaData, verifyRwaReceipt, type RwaDeployment } from '@tcg/payment-client/rwa';
import type { PaymentRequirements } from '@x402/core/types';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { SettlementAdapter } from './service.js';

/** 실패·타임아웃을 곧바로 확정 실패로 분류하지 않는다. */
export function createX402SettlementAdapter({ getWalletAddress, facilitatorUrl = 'https://x402.org/facilitator', facilitatorToken, paymentChain = 'base-sepolia', rwa }: { getWalletAddress: (auth: { userId: string; agentId: string }) => Promise<string | null>; facilitatorUrl?: string; facilitatorToken?: string; paymentChain?: PaymentChain; rwa?: RwaDeployment | null }): SettlementAdapter {
  const facilitator = new HTTPFacilitatorClient({ url: facilitatorUrl, timeoutMs: 55_000, ...(facilitatorToken ? { createAuthHeaders: async () => { const headers = { Authorization: `Bearer ${facilitatorToken}` }; return { verify: headers, settle: headers, supported: headers }; } } : {}) });
  const profile = getPaymentProfile(paymentChain);
  const chain = createPublicClient({ chain: paymentChain === 'maroo' ? marooTestnet : baseSepolia, transport: http(profile.rpcUrl) });
  const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  return {
    async verify(payload, requirements) { if(requirements.scheme==='maroo-rwa'&&!rwa)return {valid:false}; return { valid: (await facilitator.verify(payload, requirements)).isValid }; },
    async settle(payload, requirements) {
      if(requirements.scheme==='maroo-rwa'&&!rwa)return {status:'UNKNOWN'};
      const result = await facilitator.settle(payload, requirements);
      if (requirements.scheme === 'maroo-rwa' && result.transaction && rwa) {
        const receipt = await chain.getTransactionReceipt({ hash: result.transaction as `0x${string}` });
        if (receipt.status === 'reverted') return { status: 'FAILED', definitive: true, transactionHash: result.transaction };
        return { status: verifyRwaReceipt(receipt.logs, requirements, rwa) ? 'SETTLED' : 'UNKNOWN', transactionHash: result.transaction };
      }
      return { status: result.success && result.network === requirements.network && /^0x[0-9a-fA-F]{64}$/.test(result.transaction) ? 'SETTLED' : 'UNKNOWN', transactionHash: /^0x[0-9a-fA-F]{64}$/.test(result.transaction) ? result.transaction : undefined };
    },
    async reconcile(attempt) {
      if (!attempt.transactionHash || !/^0x[0-9a-fA-F]{64}$/.test(attempt.transactionHash)) return { status: 'UNKNOWN' };
      const receipt = await chain.getTransactionReceipt({ hash: attempt.transactionHash as `0x${string}` });
      if (receipt.status === 'reverted') return { status: 'FAILED', definitive: true, transactionHash: attempt.transactionHash };
      const requirements = JSON.parse(attempt.requirementsJson) as PaymentRequirements;
      const payer = await getWalletAddress(attempt);
      if (!payer) return { status: 'UNKNOWN' };
      if (requirements.network === 'eip155:450815') {
        const tx = await chain.getTransaction({ hash: attempt.transactionHash as `0x${string}` });
        const isRwa = requirements.scheme === 'maroo-rwa';
        const found = tx.from.toLowerCase() === payer.toLowerCase() && tx.to?.toLowerCase() === requirements.payTo.toLowerCase() && tx.value === BigInt(requirements.amount) && tx.input === (isRwa ? rwaData(requirements).data : nativePaymentData(requirements)) && (!isRwa || !!rwa && verifyRwaReceipt(receipt.logs, requirements, rwa));
        return { status: found ? 'SETTLED' : 'UNKNOWN', transactionHash: attempt.transactionHash };
      }
      const found = receipt.logs.some(log => {
        if (log.address.toLowerCase() !== requirements.asset.toLowerCase()) return false;
        try { const event = decodeEventLog({ abi: [transfer], data: log.data, topics: log.topics }); return event.args.from.toLowerCase() === payer.toLowerCase() && event.args.to.toLowerCase() === requirements.payTo.toLowerCase() && event.args.value === BigInt(requirements.amount); } catch { return false; }
      });
      return { status: found ? 'SETTLED' : 'UNKNOWN', transactionHash: attempt.transactionHash };
    },
  };
}
