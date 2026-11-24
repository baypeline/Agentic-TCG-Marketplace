import { HTTPFacilitatorClient } from '@x402/core/server';
import { createPublicClient, decodeEventLog, http, parseAbiItem } from 'viem';
import { baseSepolia } from 'viem/chains';
import type { SettlementAdapter } from './service.js';

/** 실패·타임아웃을 곧바로 확정 실패로 분류하지 않는다. */
export function createX402SettlementAdapter({ getWalletAddress }: { getWalletAddress: (auth: { userId: string; agentId: string }) => Promise<string | null> }): SettlementAdapter {
  const facilitator = new HTTPFacilitatorClient({ url: 'https://x402.org/facilitator' });
  const chain = createPublicClient({ chain: baseSepolia, transport: http() });
  const transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
  return {
    async verify(payload, requirements) { return { valid: (await facilitator.verify(payload, requirements)).isValid }; },
    async settle(payload, requirements) {
      const result = await facilitator.settle(payload, requirements);
      return { status: result.success && result.network === requirements.network && /^0x[0-9a-fA-F]{64}$/.test(result.transaction) ? 'SETTLED' : 'UNKNOWN', transactionHash: /^0x[0-9a-fA-F]{64}$/.test(result.transaction) ? result.transaction : undefined };
    },
    async reconcile(attempt) {
      if (!attempt.transactionHash || !/^0x[0-9a-fA-F]{64}$/.test(attempt.transactionHash)) return { status: 'UNKNOWN' };
      const receipt = await chain.getTransactionReceipt({ hash: attempt.transactionHash as `0x${string}` });
      if (receipt.status === 'reverted') return { status: 'FAILED', definitive: true, transactionHash: attempt.transactionHash };
      const requirements = JSON.parse(attempt.requirementsJson) as { asset: string; payTo: string; amount: string };
      const payer = await getWalletAddress(attempt);
      if (!payer) return { status: 'UNKNOWN' };
      const found = receipt.logs.some(log => {
        if (log.address.toLowerCase() !== requirements.asset.toLowerCase()) return false;
        try { const event = decodeEventLog({ abi: [transfer], data: log.data, topics: log.topics }); return event.args.from.toLowerCase() === payer.toLowerCase() && event.args.to.toLowerCase() === requirements.payTo.toLowerCase() && event.args.value === BigInt(requirements.amount); } catch { return false; }
      });
      return { status: found ? 'SETTLED' : 'UNKNOWN', transactionHash: attempt.transactionHash };
    },
  };
}
