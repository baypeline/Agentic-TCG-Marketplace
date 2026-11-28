import { defineChain, keccak256, parseTransaction, recoverTransactionAddress, stringToHex, type Chain, type Hex, type TransactionSerialized, type PrivateKeyAccount } from 'viem';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { getPaymentProfile } from '@tcg/contracts/payment-profile';

export const marooProfile = getPaymentProfile('maroo');
export const marooTestnet: Chain = defineChain({ id: 450815, name: 'Maroo Testnet', nativeCurrency: { name: 'Testnet OKRW', symbol: 'tOKRW', decimals: 18 }, rpcUrls: { default: { http: [marooProfile.rpcUrl] } }, blockExplorers: { default: { name: 'Maroo Explorer', url: marooProfile.explorerUrl } }, testnet: true });
export const maxNativeGasFee = 2n * 10n ** 18n;
export function nativePaymentData(requirements: PaymentRequirements): Hex {
  const quote = requirements.extra?.tcgQuoteId, expiresAt = requirements.extra?.expiresAt;
  if (typeof quote !== 'string' || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(quote) || typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt))) throw new Error('마루 지급의 주문·유효기간이 필요합니다.');
  return stringToHex(`TCG_MAROO_NATIVE_V1:${quote}:${expiresAt}`);
}
export async function inspectNativePayment(payload: PaymentPayload, requirements: PaymentRequirements) {
  const accepted = payload.accepted;
  const matches = (r: PaymentRequirements) => r.scheme === marooProfile.scheme && r.network === marooProfile.network && r.asset === marooProfile.asset && /^[1-9]\d{0,77}$/.test(r.amount) && r.extra?.tcgQuoteId === requirements.extra?.tcgQuoteId && r.extra?.expiresAt === requirements.extra?.expiresAt;
  if (!matches(requirements) || !matches(accepted) || requirements.amount !== accepted.amount || requirements.payTo.toLowerCase() !== accepted.payTo.toLowerCase()) throw new Error('마루 결제 요구가 일치하지 않습니다.');
  const raw = payload.payload.signedTransaction;
  if (typeof raw !== 'string' || !/^0x[\da-f]+$/i.test(raw) || raw.length > 4096) throw new Error('서명된 마루 트랜잭션이 필요합니다.');
  const serializedTransaction = raw as TransactionSerialized;
  const tx = parseTransaction(serializedTransaction);
  const payer = await recoverTransactionAddress({ serializedTransaction });
  const auth = payload.payload.authorization as { from?: string; to?: string; value?: string; nonce?: string } | undefined;
  const fee = tx.type === 'legacy' ? tx.gasPrice : tx.type === 'eip1559' ? tx.maxFeePerGas : undefined;
  if (tx.chainId !== 450815 || !tx.to || tx.to.toLowerCase() !== requirements.payTo.toLowerCase() || tx.value !== BigInt(requirements.amount) || tx.data !== nativePaymentData(requirements) || tx.nonce === undefined || !tx.gas || !fee || tx.gas > 300_000n || fee * tx.gas > maxNativeGasFee || ('accessList' in tx && (tx.accessList?.length ?? 0) > 0) || !auth || auth.from?.toLowerCase() !== payer.toLowerCase() || auth.to?.toLowerCase() !== tx.to.toLowerCase() || auth.value !== requirements.amount || auth.nonce !== String(tx.nonce)) throw new Error('서명된 전송의 체인·금액·수납처·주문·가스 한도를 확인하세요.');
  if (payload.resource?.url !== `mcp://tool/execute_purchase/${requirements.extra!.tcgQuoteId}`) throw new Error('주문 리소스가 일치하지 않습니다.');
  return { serializedTransaction, tx, payer, fee, hash: keccak256(serializedTransaction) };
}
export async function signNativePayment(requirements: PaymentRequirements, account: PrivateKeyAccount, request: { nonce: number; gas: bigint; gasPrice: bigint }) {
  if (request.gas * request.gasPrice > maxNativeGasFee || Date.parse(String(requirements.extra?.expiresAt)) <= Date.now()) throw new Error('마루 지급 유효기간이나 가스비 상한을 확인하세요.');
  const serializedTransaction = await account.signTransaction({ type: 'legacy', chainId: 450815, nonce: request.nonce, gas: request.gas, gasPrice: request.gasPrice, to: requirements.payTo as Hex, value: BigInt(requirements.amount), data: nativePaymentData(requirements) });
  const payload: PaymentPayload = { x402Version: 2, resource: { url: `mcp://tool/execute_purchase/${requirements.extra!.tcgQuoteId}` }, accepted: requirements, payload: { signedTransaction: serializedTransaction, authorization: { from: account.address, to: requirements.payTo, value: requirements.amount, nonce: String(request.nonce) } } };
  await inspectNativePayment(payload, requirements);
  return payload;
}
