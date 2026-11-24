import type { PaymentRequirements } from '@x402/core/types';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';

type PaymentPolicy = {
    allowedRecipient: string;
    maxAmountPerPayment: bigint; // USDC 최소 단위
};

export function validatePaymentRequirements(
    requirements: PaymentRequirements,
    policy: PaymentPolicy,
): void {
    if (requirements.scheme !== 'exact' || requirements.network !== 'eip155:84532') {
        throw new Error('허용하지 않은 결제 방식 또는 네트워크입니다.');
    }

    if (requirements.asset.toLowerCase() !== BASE_SEPOLIA_USDC.toLowerCase()) {
        throw new Error('허용하지 않은 결제 토큰입니다.');
    }

    if (
        !/^0x[0-9a-fA-F]{40}$/.test(policy.allowedRecipient) ||
        requirements.payTo.toLowerCase() !== policy.allowedRecipient.toLowerCase()
    ) {
        throw new Error('허용하지 않은 수납 주소입니다.');
    }

    if (!/^[1-9]\d*$/.test(requirements.amount)) {
        throw new Error('결제 금액은 최소 단위의 양의 정수여야 합니다.');
    }

    if (BigInt(requirements.amount) > policy.maxAmountPerPayment) {
        throw new Error('건당 결제 한도를 초과했습니다.');
    }
}

export async function signPayment(
    requirements: PaymentRequirements,
    policy: PaymentPolicy,
    account: ConstructorParameters<typeof ExactEvmScheme>[0],
    resourceUrl: string,
) {
    validatePaymentRequirements(requirements, policy);

    const client = new x402Client();
    client.register('eip155:84532', new ExactEvmScheme(account));

    return client.createPaymentPayload({
        x402Version: 2,
        resource: { url: resourceUrl },
        accepts: [requirements],
    });
}
