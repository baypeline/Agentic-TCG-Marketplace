import { decodeEventLog, encodeFunctionData, keccak256, parseTransaction, recoverTransactionAddress, verifyTypedData, type Hex, type PrivateKeyAccount, type TransactionSerialized } from 'viem';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';
import { z } from 'zod';
import { cardMarketplaceAbi, cardVaultAbi } from '@tcg/payment-client/rwa-abi';
export { cardMarketplaceAbi, cardVaultAbi };
const address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(x => x.toLowerCase() as Hex);
const hex32 = z.string().regex(/^0x[\da-fA-F]{64}$/).transform(x => x.toLowerCase() as Hex);
const integer = z.string().regex(/^(0|[1-9]\d*)$/).max(78);
export const rwaQuoteSchema = z.object({ quoteId: hex32, listingId: integer, nft: address, tokenId: integer, buyer: address, recipient: address, seller: address, amount: integer, deadline: integer, policyHash: hex32 }).strict();
export type RwaQuote = z.infer<typeof rwaQuoteSchema>;
export interface RwaDeployment { market: Hex; nft: Hex; marketCodeHash: Hex; nftCodeHash: Hex; quoteSigner: Hex }
export function readRwaDeployment(env: Record<string, unknown>): RwaDeployment | null {
  if (!env.RWA_MARKET_ADDRESS) return null;
  return { market: address.parse(env.RWA_MARKET_ADDRESS), nft: address.parse(env.RWA_NFT_ADDRESS), marketCodeHash: hex32.parse(env.RWA_MARKET_CODE_HASH), nftCodeHash: hex32.parse(env.RWA_NFT_CODE_HASH), quoteSigner: address.parse(env.RWA_QUOTE_SIGNER) };
}
const detailSchema = z.object({ quote: rwaQuoteSchema, signature: z.string().regex(/^0x[\da-fA-F]{130}$/), calldataHash: hex32 }).strict();
export const quoteTypes = { Quote: [
  { name: 'quoteId', type: 'bytes32' }, { name: 'listingId', type: 'uint256' }, { name: 'nft', type: 'address' }, { name: 'tokenId', type: 'uint256' }, { name: 'buyer', type: 'address' }, { name: 'recipient', type: 'address' }, { name: 'seller', type: 'address' }, { name: 'amount', type: 'uint256' }, { name: 'deadline', type: 'uint256' }, { name: 'policyHash', type: 'bytes32' },
] } as const;
export function quoteMessage(q: RwaQuote) { return { ...q, listingId: BigInt(q.listingId), tokenId: BigInt(q.tokenId), amount: BigInt(q.amount), deadline: BigInt(q.deadline) }; }
export function quoteDomain(market: Hex) { return { name: 'AgenticTCGMarketplace', version: '1', chainId: 450815, verifyingContract: market } as const; }
export function rwaData(requirements: PaymentRequirements) {
  const detail = detailSchema.parse(requirements.extra?.rwa);
  const data = encodeFunctionData({ abi: cardMarketplaceAbi, functionName: 'buyListing', args: [quoteMessage(detail.quote), detail.signature as Hex] });
  if (keccak256(data) !== detail.calldataHash) throw new Error('RWA calldata mismatch');
  return { ...detail, data };
}
export async function validateRwaRequirements(requirements: PaymentRequirements, deployment: RwaDeployment) {
  if (requirements.scheme !== 'maroo-rwa' || requirements.network !== 'eip155:450815' || requirements.asset !== 'native:tOKRW' || requirements.payTo.toLowerCase() !== deployment.market.toLowerCase()) throw new Error('RWA deployment mismatch');
  const detail = rwaData(requirements), q = detail.quote;
  if (q.nft !== deployment.nft.toLowerCase() || q.amount !== requirements.amount || q.buyer !== q.recipient || BigInt(q.amount) <= 0n || BigInt(q.amount) > 25n*10n**18n || q.quoteId !== keccak256(new TextEncoder().encode(String(requirements.extra?.tcgQuoteId))) || Number(q.deadline) !== Math.floor(Date.parse(String(requirements.extra?.expiresAt))/1000)) throw new Error('RWA quote mismatch');
  if (!await verifyTypedData({ address: deployment.quoteSigner, domain: quoteDomain(deployment.market), types: quoteTypes, primaryType: 'Quote', message: quoteMessage(q), signature: detail.signature as Hex })) throw new Error('Invalid quote signature');
  return detail;
}
export async function signRwaPayment(requirements: PaymentRequirements, account: PrivateKeyAccount, deployment: RwaDeployment, request: { nonce: number; gas: bigint; gasPrice: bigint }) {
  const detail = await validateRwaRequirements(requirements, deployment);
  if (detail.quote.buyer !== account.address.toLowerCase() || Number(detail.quote.deadline) <= Date.now()/1000 || request.gas*request.gasPrice > 10n*10n**18n || request.gas > 1_000_000n) throw new Error('RWA payer, expiry or gas mismatch');
  const raw = await account.signTransaction({ type: 'legacy', chainId: 450815, to: deployment.market, nonce: request.nonce, value: BigInt(requirements.amount), data: detail.data, gas: request.gas, gasPrice: request.gasPrice });
  return { x402Version: 2, resource: { url: `mcp://tool/execute_purchase/${requirements.extra!.tcgQuoteId}` }, accepted: requirements, payload: { signedTransaction: raw, authorization: { from: account.address, to: deployment.market, value: requirements.amount, nonce: String(request.nonce) } } } satisfies PaymentPayload;
}
export async function inspectRwaPayment(payload: PaymentPayload, requirements: PaymentRequirements, deployment: RwaDeployment) {
  const detail = await validateRwaRequirements(requirements, deployment);
  if (JSON.stringify(payload.accepted) !== JSON.stringify(requirements) || payload.resource?.url !== `mcp://tool/execute_purchase/${requirements.extra!.tcgQuoteId}`) throw new Error('RWA acceptance mismatch');
  const raw = payload.payload.signedTransaction;
  if (typeof raw !== 'string' || !/^0x[\da-f]+$/i.test(raw) || raw.length > 8192) throw new Error('Invalid RWA transaction');
  const serializedTransaction = raw as TransactionSerialized, tx = parseTransaction(serializedTransaction);
  const payer = await recoverTransactionAddress({ serializedTransaction });
  const auth = payload.payload.authorization as Record<string, string> | undefined;
  if (tx.type !== 'legacy' || tx.chainId !== 450815 || tx.to?.toLowerCase() !== deployment.market.toLowerCase() || tx.value !== BigInt(requirements.amount) || tx.data !== detail.data || payer.toLowerCase() !== detail.quote.buyer || !tx.gas || tx.gas > 1_000_000n || !tx.gasPrice || tx.gas*tx.gasPrice > 10n*10n**18n || auth?.from?.toLowerCase() !== payer.toLowerCase() || auth.to?.toLowerCase() !== deployment.market.toLowerCase() || auth.value !== requirements.amount || auth.nonce !== String(tx.nonce)) throw new Error('RWA signed call mismatch');
  return { serializedTransaction, tx, payer, fee: tx.gasPrice, hash: keccak256(serializedTransaction), detail };
}
export function verifyRwaReceipt(logs: readonly { address: string; data: Hex; topics: readonly Hex[] }[], requirements: PaymentRequirements, deployment: RwaDeployment) {
  const { quote: q } = rwaData(requirements); let purchase = false, transfer = false;
  for (const log of logs) {
    try {
      if (log.address.toLowerCase() === deployment.market.toLowerCase()) {
        const event = decodeEventLog({ abi: cardMarketplaceAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (event.eventName === 'PurchaseExecuted') { const a = event.args; purchase ||= a.quoteId === q.quoteId && a.listingId === BigInt(q.listingId) && a.buyer.toLowerCase() === q.buyer && a.recipient.toLowerCase() === q.recipient && a.seller.toLowerCase() === q.seller && a.nft.toLowerCase() === q.nft && a.tokenId === BigInt(q.tokenId) && a.amount === BigInt(q.amount); }
      }
      if (log.address.toLowerCase() === deployment.nft.toLowerCase()) {
        const event = decodeEventLog({ abi: cardVaultAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
        if (event.eventName === 'Transfer') transfer ||= event.args.from.toLowerCase() === deployment.market.toLowerCase() && event.args.to.toLowerCase() === q.buyer && event.args.tokenId === BigInt(q.tokenId);
      }
    } catch { /* Other events are not settlement evidence. */ }
  }
  return purchase && transfer;
}
