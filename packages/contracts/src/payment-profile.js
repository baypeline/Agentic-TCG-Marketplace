export const paymentProfiles = Object.freeze({
  'base-sepolia': Object.freeze({ chain: 'base-sepolia', chainId: 84532, network: 'eip155:84532', scheme: 'exact', asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e', currency: 'USDC', decimals: 6, rpcUrl: 'https://sepolia.base.org', explorerUrl: 'https://sepolia.basescan.org', paymentMode: 'X402_BASE_SEPOLIA', maxPerTrade: '25000', totalBudget: '100000', seedMultiplier: '1' }),
  maroo: Object.freeze({ chain: 'maroo', chainId: 450815, network: 'eip155:450815', scheme: 'maroo-native', asset: 'native:tOKRW', currency: 'tOKRW', decimals: 18, rpcUrl: 'https://rpc-testnet.maroo.io', explorerUrl: 'https://explorer-testnet.maroo.io', paymentMode: 'X402_MAROO_NATIVE', maxPerTrade: '25000000000000000000', totalBudget: '100000000000000000000', seedMultiplier: '1000000000000000' }),
});
export function getPaymentProfile(chain = 'base-sepolia') {
  const profile = Object.hasOwn(paymentProfiles, chain) ? paymentProfiles[chain] : undefined;
  if (!profile) throw new Error('지원하지 않는 결제 체인입니다.');
  return profile;
}
export function profileForNetwork(network) {
  const profile = Object.values(paymentProfiles).find(profile => profile.network === network);
  if (!profile) throw new Error('지원하지 않는 결제 네트워크입니다.');
  return profile;
}
export function formatMoney(amount, currency = 'USDC') {
  const decimals = currency === 'tOKRW' ? 18 : 6;
  const scale = 10n ** BigInt(decimals), value = BigInt(amount);
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${(value / scale).toLocaleString('en-US')}${fraction ? `.${fraction}` : ''} ${currency}`;
}
