import { AsyncLocalStorage } from 'node:async_hooks';
import { x402Facilitator } from '@x402/core/facilitator';
import type { PaymentPayload, PaymentRequirements, SettleResponse, VerifyResponse } from '@x402/core/types';
import { toFacilitatorEvmSigner } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import { createWalletClient, decodeEventLog, http, parseAbiItem, publicActions } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { baseSepolia } from 'viem/chains';
import { network, type FacilitatorEnv } from './config.js';

export interface Engine {
  address: string;
  supported(): unknown;
  verify(payload: PaymentPayload, requirements: PaymentRequirements): Promise<VerifyResponse>;
  settle(payload: PaymentPayload, requirements: PaymentRequirements, broadcast: (hash: string) => void): Promise<SettleResponse>;
  reconcile(hash: string, payload: PaymentPayload, requirements: PaymentRequirements): Promise<SettleResponse>;
}
export async function createEngine(env: FacilitatorEnv): Promise<Engine> {
  const account = privateKeyToAccount(env.FACILITATOR_PRIVATE_KEY as `0x${string}`);
  if ([env.FACILITATOR_RECIPIENT.toLowerCase(), ...env.FACILITATOR_PAYERS].includes(account.address.toLowerCase())) throw new Error('퍼실리테이터는 구매·수납 지갑과 분리해야 합니다.');
  const client = createWalletClient({ account, chain: baseSepolia, transport: http(env.FACILITATOR_RPC_URL, { timeout: 10_000, retryCount: 1 }) }).extend(publicActions);
  if (await client.getChainId() !== baseSepolia.id) throw new Error('RPC 체인이 Base Sepolia와 일치하지 않습니다.');
  const scope = new AsyncLocalStorage<(hash: string) => void>();
  const signer = toFacilitatorEvmSigner({ ...client, address: account.address,
    writeContract: async (args: Parameters<typeof client.writeContract>[0]) => {
      const hash = await client.writeContract(args);
      scope.getStore()?.(hash);
      return hash;
    },
  } as Parameters<typeof toFacilitatorEvmSigner>[0], { confirmationTimeoutMs: 40_000 });
  const facilitator = new x402Facilitator().register(network, new ExactEvmScheme(signer, { eip6492AllowedFactories: [], simulateInSettle: true }));
  return {
    address: account.address,
    supported: () => facilitator.getSupported(),
    verify: (payload, requirements) => facilitator.verify(payload, requirements),
    settle: (payload, requirements, broadcast) => scope.run(broadcast, () => facilitator.settle(payload, requirements)),
    async reconcile(hash, payload, requirements) {
      const receipt = await client.getTransactionReceipt({ hash: hash as `0x${string}` });
      const payer = (payload.payload.authorization as { from: string }).from;
      const transfer = parseAbiItem('event Transfer(address indexed from,address indexed to,uint256 value)');
      const moved = receipt.logs.some(log => {
        if (log.address.toLowerCase() !== requirements.asset.toLowerCase()) return false;
        try { const event = decodeEventLog({ abi: [transfer], data: log.data, topics: log.topics }); return event.args.from.toLowerCase() === payer.toLowerCase() && event.args.to.toLowerCase() === requirements.payTo.toLowerCase() && event.args.value === BigInt(requirements.amount); }
        catch { return false; }
      });
      // SDK가 보낸 동일 트랜잭션의 receipt만 조회하며 재전송하지 않는다.
      const success = receipt.status === 'success' && moved;
      return { success, network: requirements.network, transaction: hash, payer, ...(success ? {} : { errorReason: 'transaction_failed' }) };
    },
  };
}
