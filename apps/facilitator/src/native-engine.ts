import { createWalletClient, http, publicActions, keccak256, type Hex } from 'viem';
import { inspectRwaPayment, readRwaDeployment, verifyRwaReceipt } from '@tcg/payment-client/rwa';
import { privateKeyToAccount } from 'viem/accounts';
import { inspectNativePayment, marooProfile, marooTestnet, nativePaymentData } from '@tcg/payment-client/native';
import type { Engine } from './engine.js';
import type { FacilitatorEnv } from './config.js';

export async function createNativeEngine(env: FacilitatorEnv): Promise<Engine> {
  const operator = privateKeyToAccount(env.FACILITATOR_PRIVATE_KEY as Hex);
  const client = createWalletClient({ chain: marooTestnet, transport: http(env.FACILITATOR_RPC_URL, { timeout: 10_000, retryCount: 1 }) }).extend(publicActions);
  if (await client.getChainId() !== 450815) throw new Error('마루 테스트넷 RPC가 아닙니다.');
  const rwa = readRwaDeployment(env);
  const inspect = (payload: Parameters<Engine['verify']>[0], requirements: Parameters<Engine['verify']>[1]) => {
    if (requirements.scheme === 'maroo-rwa') { if (!rwa) throw new Error('RWA disabled'); return inspectRwaPayment(payload, requirements, rwa); }
    return inspectNativePayment(payload, requirements);
  };
  const verify: Engine['verify'] = async (payload, requirements) => {
    try {
      const info = await inspect(payload, requirements);
      if (Date.parse(String(requirements.extra?.expiresAt)) <= Date.now()) return { isValid: false, invalidReason: 'authorization_expired' };
      const [nonce, balance, gas, recipientCode] = await Promise.all([
        client.getTransactionCount({ address: info.payer, blockTag: 'pending' }),
        client.getBalance({ address: info.payer }),
        client.estimateGas({ account: info.payer, to: info.tx.to!, value: info.tx.value!, data: info.tx.data }),
        client.getCode({ address: info.tx.to! }),
      ]);
      if (requirements.scheme === 'maroo-rwa') {
        const nftCode = await client.getCode({ address: rwa!.nft });
        if (!recipientCode || !nftCode || keccak256(recipientCode) !== rwa!.marketCodeHash || keccak256(nftCode) !== rwa!.nftCodeHash) return { isValid: false, invalidReason: 'deployment_code_mismatch' };
      } else if (recipientCode && recipientCode !== '0x') return { isValid: false, invalidReason: 'recipient_must_be_eoa' };
      if (nonce !== info.tx.nonce || balance < info.tx.value! + info.tx.gas! * info.fee || info.tx.gas! < gas || info.tx.gas! > gas * 2n) return { isValid: false, invalidReason: 'nonce_balance_or_gas_mismatch' };
      return { isValid: true, payer: info.payer };
    } catch { return { isValid: false, invalidReason: 'native_verification_failed' }; }
  };
  const engine: Engine = {
    address: operator.address,
    supported: () => ({ kinds: [{ x402Version: 2, scheme: marooProfile.scheme, network: marooProfile.network, extra: { asset: marooProfile.asset, gasPayer: 'buyer', implementation: 'tcg-maroo-native-v1' } }, ...(rwa ? [{ x402Version: 2, scheme: 'maroo-rwa', network: marooProfile.network, extra: { asset: marooProfile.asset, market: rwa.market, nft: rwa.nft, gasPayer: 'buyer' } }] : [])], extensions: [], signers: {} }),
    verify,
    async settle(payload, requirements, broadcast) {
      const result = await verify(payload, requirements);
      if (!result.isValid) return { success: false, errorReason: result.invalidReason ?? 'invalid_payment', network: marooProfile.network, transaction: '' };
      const info = await inspect(payload, requirements);
      // 전송 전에 서명된 원문의 해시를 저장한다. 개인키·원문은 영속화하지 않는다.
      broadcast(info.hash);
      const sent = await client.sendRawTransaction({ serializedTransaction: info.serializedTransaction });
      if (sent.toLowerCase() !== info.hash.toLowerCase()) throw new Error('전송 해시 불일치');
      await client.waitForTransactionReceipt({ hash: info.hash, timeout: 40_000 });
      return this.reconcile(info.hash, payload, requirements);
    },
    async reconcile(hash, payload, requirements) {
      const info = await inspect(payload, requirements);
      if (hash.toLowerCase() !== info.hash.toLowerCase()) throw new Error('정산 해시 불일치');
      const [receipt, tx] = await Promise.all([client.getTransactionReceipt({ hash: info.hash }), client.getTransaction({ hash: info.hash })]);
      if(requirements.scheme==='maroo-rwa') {const finalized=await client.getBlock({blockTag:'finalized'});if(finalized.number===null||receipt.blockNumber>finalized.number)throw new Error('Awaiting finalized RWA block');}
      const success = receipt.status === 'success' && tx.from.toLowerCase() === info.payer.toLowerCase() && tx.to?.toLowerCase() === requirements.payTo.toLowerCase() && tx.value === BigInt(requirements.amount) && tx.input === info.tx.data && (requirements.scheme !== 'maroo-rwa' || verifyRwaReceipt(receipt.logs, requirements, rwa!));
      return { success, transaction: hash, network: marooProfile.network, payer: info.payer, ...(success ? {} : { errorReason: 'transaction_failed' }) };
    },
  };
  return engine;
}
