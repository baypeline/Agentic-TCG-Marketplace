export type PaymentChain = 'base-sepolia' | 'maroo';
export type Currency = 'USDC' | 'tOKRW';
export interface PaymentProfile {
  readonly chain: PaymentChain;
  readonly chainId: number;
  readonly network: 'eip155:84532' | 'eip155:450815';
  readonly scheme: 'exact' | 'maroo-native';
  readonly asset: string;
  readonly currency: Currency;
  readonly decimals: number;
  readonly rpcUrl: string;
  readonly explorerUrl: string;
  readonly paymentMode: 'X402_BASE_SEPOLIA' | 'X402_MAROO_NATIVE';
  readonly maxPerTrade: string;
  readonly totalBudget: string;
  readonly seedMultiplier: string;
}
export const paymentProfiles: Readonly<Record<PaymentChain, PaymentProfile>>;
export function getPaymentProfile(chain?: PaymentChain): PaymentProfile;
export function profileForNetwork(network: string): PaymentProfile;
export function formatMoney(amount: string, currency?: Currency): string;
