import { expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { recoverTypedDataAddress } from 'viem';
import { parseApiEnv } from '@tcg/config';
import { createAgentWallet } from '../src/agent-wallet.js';

const key = `0x${'11'.repeat(32)}` as const; // 공개 테스트 전용 키이며 실제 지갑과 무관
const account = privateKeyToAccount(key);
const recipient = `0x${'2'.repeat(40)}`;
const env = parseApiEnv({ NODE_ENV: 'test', AGENT_SIGNING_MODE: 'server', AGENT_SERVER_WALLET_ADDRESS: account.address, AGENT_WALLET_ADDRESS: account.address, PAYMENT_RECIPIENT: recipient, PAYMENT_ENABLED: 'true', DEMO_SCENARIOS_ENABLED: 'true', DATABASE_ENABLED: 'true', DATABASE_URL: 'postgresql://localhost/unused', CARD_DATA_SOURCE: 'database', TRADING_DATA_SOURCE: 'database', DEMO_BUYER_TOKEN: 'b'.repeat(32), DEMO_SELLER_TOKEN: 's'.repeat(32) });
const requirements = { scheme: 'exact' as const, network: 'eip155:84532' as const, asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e' as const, amount: '10000', payTo: recipient, maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } };
const input = { requirements, amount: '10000', matchQuoteId: '00000000-0000-4000-8200-000000000001' };

it('전용 개인키로 유효한 x402 EIP-3009 서명을 생성한다', async () => {
  const wallet = createAgentWallet(env, { AGENT_SERVER_PRIVATE_KEY: key }, { readBalance: async () => 100000n })!;
  const signed = await wallet.sign(input) as { x402Version: number; payload: { authorization: Record<string, string>; signature: `0x${string}` } };
  expect(signed.x402Version).toBe(2);
  const auth = signed.payload.authorization;
  expect(auth.from).toBe(account.address);
  expect(auth.to?.toLowerCase()).toBe(recipient.toLowerCase());
  const recovered = await recoverTypedDataAddress({ domain: { name: 'USDC', version: '2', chainId: 84532, verifyingContract: requirements.asset }, primaryType: 'TransferWithAuthorization', types: { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] }, message: { from: auth.from as `0x${string}`, to: auth.to as `0x${string}`, nonce: auth.nonce as `0x${string}`, value: BigInt(auth.value!), validAfter: BigInt(auth.validAfter!), validBefore: BigInt(auth.validBefore!) }, signature: signed.payload.signature });
  expect(recovered).toBe(account.address);
  expect(JSON.stringify(signed)).not.toContain(key);
});

it('잔액 부족과 변조된 금액·수납처·네트워크·토큰·초과 금액을 거부한다', async () => {
  const readBalance = vi.fn(async () => 0n);
  const wallet = createAgentWallet(env, { AGENT_SERVER_PRIVATE_KEY: key }, { readBalance })!;
  await expect(wallet.sign(input)).rejects.toThrow('충전');
  for (const change of [{ amount: '25001' }, { payTo: account.address }, { network: 'eip155:8453' }, { asset: recipient }, { extra: { name: 'USDC', version: '2', assetTransferMethod: 'permit2' } }]) {
    await expect(wallet.sign({ ...input, requirements: { ...requirements, ...change } as typeof requirements })).rejects.toThrow();
  }
  await expect(wallet.sign({ ...input, amount: '25001', requirements: { ...requirements, amount: '25001' } })).rejects.toThrow('한도');
  expect(readBalance).toHaveBeenCalledTimes(1);
});

it('브라우저 모드는 키를 읽지 않으며 잘못된 키·주소·운영 환경은 비밀값 없이 거부한다', () => {
  expect(createAgentWallet({ ...env, AGENT_SIGNING_MODE: 'browser' }, {})).toBeNull();
  expect(() => createAgentWallet(env, { AGENT_SERVER_PRIVATE_KEY: 'invalid-secret' })).toThrow('AGENT_SERVER_PRIVATE_KEY');
  expect(() => createAgentWallet({ ...env, AGENT_SERVER_WALLET_ADDRESS: recipient }, { AGENT_SERVER_PRIVATE_KEY: key })).toThrow('설정');
  expect(() => createAgentWallet({ ...env, NODE_ENV: 'production' }, { AGENT_SERVER_PRIVATE_KEY: key })).toThrow('로컬');
});
