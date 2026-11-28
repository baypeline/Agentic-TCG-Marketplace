import { expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { inspectNativePayment, marooProfile, nativePaymentData, signNativePayment } from '../src/native.js';

const account = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const requirements = { scheme: marooProfile.scheme, network: marooProfile.network, asset: marooProfile.asset, amount: '5000000000000000000', payTo: `0x${'2'.repeat(40)}`, maxTimeoutSeconds: 60, extra: { tcgQuoteId: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(Date.now() + 60_000).toISOString() } };
const request = { nonce: 0, gas: 30000n, gasPrice: 1_000_000_000n };
it('마루 네이티브 서명에 체인·금액·수납처·주문을 암호학적으로 결합한다', async () => {
  const payload = await signNativePayment(requirements, account, request);
  const info = await inspectNativePayment(payload, requirements);
  expect(info.payer).toBe(account.address);
  expect(info.tx.value).toBe(5n * 10n ** 18n);
  expect(info.tx.chainId).toBe(450815);
  expect(info.tx.data).toBe(nativePaymentData(requirements));
  expect(JSON.stringify(payload)).not.toContain('0x' + '11'.repeat(32));
});
it('서명 이후 금액·체인·주문·리소스·송신자를 바꾸거나 과도한 가스비를 요청하면 거부한다', async () => {
  const payload = await signNativePayment(requirements, account, request);
  for (const change of [{ amount: '6000000000000000000' }, { network: 'eip155:84532' as const }, { payTo: account.address }, { extra: { ...requirements.extra, tcgQuoteId: '00000000-0000-4000-8000-000000000002' } }]) {
    await expect(inspectNativePayment(payload, { ...requirements, ...change })).rejects.toThrow();
  }
  await expect(inspectNativePayment({ ...payload, resource: { url: 'https://wrong.test' } }, requirements)).rejects.toThrow();
  await expect(inspectNativePayment({ ...payload, payload: { ...payload.payload, authorization: { from: requirements.payTo } } }, requirements)).rejects.toThrow();
  await expect(signNativePayment(requirements, account, { ...request, gasPrice: 10n ** 18n })).rejects.toThrow();
});
