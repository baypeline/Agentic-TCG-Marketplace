import { createWalletClient, custom, type EIP1193Provider } from 'viem';
import { baseSepolia } from 'viem/chains';
import { marooTestnet } from '@tcg/payment-client/native';
import { walletChallengeSchema, walletSessionSchema, agentWalletInfoSchema } from '@tcg/contracts';

export const walletQueryKey = ['wallet-session'] as const;
async function response(result: Response) { const data = await result.json(); if (!result.ok) throw new Error(data.message ?? '지갑 인증에 실패했습니다.'); return data; }
export async function getWalletSession() { return walletSessionSchema.parse(await response(await fetch('/api/auth/session', { cache: 'no-store' }))); }
export async function getAgentWallet() { return agentWalletInfoSchema.parse(await response(await fetch('/api/agent-wallet', { cache: 'no-store' }))); }
export async function logoutWallet() { await response(await fetch('/api/auth/logout', { method: 'POST' })); }
export async function loginWallet(provider: EIP1193Provider) {
  const wallet = createWalletClient({ transport: custom(provider) });
  const [address] = await wallet.requestAddresses();
  if (!address) throw new Error('로그인할 지갑을 선택해 주세요.');
  const challenge = walletChallengeSchema.parse(await response(await fetch('/api/auth/challenge', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ address }) })));
  const chain = challenge.chainId === marooTestnet.id ? marooTestnet : challenge.chainId === baseSepolia.id ? baseSepolia : null;
  if (!chain) throw new Error('지원하지 않는 로그인 네트워크입니다.');
  if (await wallet.getChainId() !== chain.id) {
    try { await wallet.switchChain({ id: chain.id }); }
    catch (error) { if ((error as { code?: number }).code !== 4902) throw error; await wallet.addChain({ chain }); await wallet.switchChain({ id: chain.id }); }
  }
  const signature = await wallet.signMessage({ account: address, message: challenge.message });
  const [current] = await wallet.getAddresses();
  if (current?.toLowerCase() !== address.toLowerCase()) throw new Error('선택한 지갑이 변경됐습니다. 다시 로그인해 주세요.');
  return walletSessionSchema.parse(await response(await fetch('/api/auth/verify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ signature }) })));
}
