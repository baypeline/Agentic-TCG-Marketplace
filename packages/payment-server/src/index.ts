import { HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types';

const BASE_SEPOLIA_USDC = '0x036CbD53842c5426634e7929541eC2318f3dCF7e';
const TEST_PAYMENT_AMOUNT = '10000'; // 0.01 USDC

export function createTestPaymentRequirements(
    platformWalletAddress: string,
): PaymentRequirements {
    return {
        scheme: 'exact',
        network: 'eip155:84532',
        asset: BASE_SEPOLIA_USDC,
        amount: TEST_PAYMENT_AMOUNT,
        payTo: platformWalletAddress,
        maxTimeoutSeconds: 60,
        extra: {
            name: 'USDC',
            version: '2',
        },
    };
}

const facilitator = new HTTPFacilitatorClient({
    url: 'https://x402.org/facilitator',
});

const MAX_AMOUNT_PER_PAYMENT = 10_000n; // 0.01 USDC

function validatePaymentAmount(
    signedPayment: PaymentPayload,
    expectedRequirements: PaymentRequirements,
): void {
    const { amount } = expectedRequirements;

    if (typeof amount !== 'string' || !/^[1-9]\d*$/.test(amount)) {
        throw new Error('결제 금액은 최소 단위의 양의 정수여야 합니다.');
    }

    if (BigInt(amount) > MAX_AMOUNT_PER_PAYMENT) {
        throw new Error('서버 건당 결제 한도를 초과했습니다.');
    }

    const authorization = signedPayment.payload.authorization;
    if (
        signedPayment.accepted.amount !== amount ||
        typeof authorization !== 'object' ||
        authorization === null ||
        !('value' in authorization) ||
        authorization.value !== amount
    ) {
        throw new Error('서명된 지급 금액이 서버의 결제 요구와 일치하지 않습니다.');
    }
}

export async function verifyPayment(
    signedPayment: PaymentPayload,
    expectedRequirements: PaymentRequirements,
) {
    validatePaymentAmount(signedPayment, expectedRequirements);
    return facilitator.verify(signedPayment, expectedRequirements);
}

export async function settlePayment(
    signedPayment: PaymentPayload,
    expectedRequirements: PaymentRequirements,
) {
    validatePaymentAmount(signedPayment, expectedRequirements);
    return facilitator.settle(signedPayment, expectedRequirements);
}