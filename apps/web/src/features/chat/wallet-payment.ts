import { createWalletClient, createPublicClient, custom, parseAbi, type EIP1193Provider } from 'viem';
import { baseSepolia } from 'viem/chains';
import { signPayment } from '@tcg/payment-client';
import type { AgentPurchaseOffer, AgentPurchaseProgress } from '@tcg/contracts';

export async function connectPaymentWallet() {
  const provider = (window as Window & { ethereum?: EIP1193Provider }).ethereum;
  if (!provider) throw new Error('MetaMask 등 브라우저 지갑을 설치한 뒤 다시 시도해 주세요.');
  const wallet = createWalletClient({ transport: custom(provider), chain: baseSepolia });
  const [account] = await wallet.requestAddresses();
  if (!account) throw new Error('구매에 사용할 지갑을 선택해 주세요.');
  if (await wallet.getChainId() !== baseSepolia.id) {
    try { await wallet.switchChain({ id: baseSepolia.id }); }
    catch (error) {
      if ((error as { code?: number }).code !== 4902) throw error;
      await wallet.addChain({ chain: baseSepolia });
      await wallet.switchChain({ id: baseSepolia.id });
    }
  }
  return { account, async sign(prepared: AgentPurchaseProgress, offer: AgentPurchaseOffer) {
    if (!prepared.requirements || prepared.amount !== offer.price || prepared.listingId !== offer.listingId) throw new Error('선택한 매물과 결제 요청이 다릅니다.');
    if (account.toLowerCase() !== prepared.payer.toLowerCase()) throw new Error('서버에 설정된 구매자 지갑으로 전환해 주세요.');
    if (await wallet.getChainId() !== baseSepolia.id) throw new Error('지갑 네트워크를 Base Sepolia로 전환해 주세요.');
    const chain = createPublicClient({ transport: custom(provider), chain: baseSepolia });
    const balance = await chain.readContract({ address: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', abi: parseAbi(['function balanceOf(address) view returns (uint256)']), functionName: 'balanceOf', args: [account] });
    if (balance < BigInt(offer.price)) throw new Error('Base Sepolia 테스트 USDC 잔액이 부족합니다.');
    const signer = createWalletClient({ account, transport: custom(provider), chain: baseSepolia });
    return signPayment(prepared.requirements, { allowedRecipient: prepared.recipient, maxAmountPerPayment: BigInt(offer.price) }, { address: account, signTypedData: data => signer.signTypedData(data as Parameters<typeof signer.signTypedData>[0]) }, `mcp://tool/execute_purchase/${prepared.matchQuoteId}`);
  } };
}

export function walletErrorMessage(error: unknown) {
  let current = error;
  for (let depth = 0; current && depth < 5; depth++) {
    if ((current as { code?: number }).code === 4001) return '지갑 연결 또는 서명을 취소했어요. 결제하지 않았습니다.';
    current = (current as { cause?: unknown }).cause;
  }
  return error instanceof Error && !('details' in error) ? error.message : '지갑 요청을 완료하지 못했어요. 네트워크와 잔액을 확인해 주세요.';
}
