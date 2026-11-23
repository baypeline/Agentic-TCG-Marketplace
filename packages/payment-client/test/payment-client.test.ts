import type { PaymentRequirements } from '@x402/core/types';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { expect, it, vi } from 'vitest';
import { signPayment, validatePaymentRequirements } from '../src/index.js';

const recipient = '0x1111111111111111111111111111111111111111';
const policy = { allowedRecipient: recipient, maxAmountPerPayment: 10_000n };

const requirements: PaymentRequirements = {
    scheme: 'exact',
    network: 'eip155:84532',
    asset: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    amount: '10000',
    payTo: recipient,
    maxTimeoutSeconds: 60,
    extra: { name: 'USDC', version: '2' },
};

const resourceUrl = 'http://localhost/test-purchase';

it('금액이 건당 한도와 정확히 같으면 허용한다', () => {
    expect(() => validatePaymentRequirements(requirements, policy)).not.toThrow();
});

it('한도를 최소 단위 1만큼 초과하면 거절한다', () => {
    const overLimit = { ...requirements, amount: '10001' };

    expect(() => validatePaymentRequirements(overLimit, policy)).toThrow(/한도/);
});

it('금액이 한도 안이어도 수납 주소가 바뀌면 거절한다', () => {
    const wrongRecipient = {
        ...requirements,
        payTo: '0x2222222222222222222222222222222222222222',
    };

    expect(() => validatePaymentRequirements(wrongRecipient, policy)).toThrow(/수납 주소/);
});

it('정상 요청은 에이전트가 지정된 수신자와 금액에 서명한다', async () => {
    const account = privateKeyToAccount(generatePrivateKey());

    const signed = await signPayment(requirements, policy, account, resourceUrl);

    expect(signed.payload.signature).toMatch(/^0x[0-9a-f]{130}$/i);
    expect(signed.payload.authorization).toMatchObject({
        from: account.address,
        to: recipient,
        value: '10000',
    });
});

it('한도를 초과하면 지갑의 서명 함수를 호출하지 않는다', async () => {
    const account = privateKeyToAccount(generatePrivateKey());
    const signer = vi.spyOn(account, 'signTypedData');
    const overLimit = { ...requirements, amount: '10001' };

    await expect(signPayment(overLimit, policy, account, resourceUrl)).rejects.toThrow(/한도/);
    expect(signer).not.toHaveBeenCalled();
});