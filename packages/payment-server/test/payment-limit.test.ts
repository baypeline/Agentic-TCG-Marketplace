import { HTTPFacilitatorClient } from '@x402/core/server';
import type { PaymentPayload } from '@x402/core/types';
import { afterEach, expect, it, vi } from 'vitest';
import {
    createTestPaymentRequirements,
    verifyPayment,
    settlePayment,
} from '../src/index.js';

afterEach(() => {
    vi.restoreAllMocks();
});

it.each([
    { method: 'verify', execute: verifyPayment },
    { method: 'settle', execute: settlePayment },
] as const)('$method 호출 전에 서버가 건별 한도 초과를 거절한다', async ({
                                                           method,
                                                           execute,
                                                       }) => {
    const facilitator = vi.spyOn(HTTPFacilitatorClient.prototype, method)
        .mockRejectedValue(new Error('Facilitator까지 요청이 전달됐습니다.'));

    const recipient = '0x1111111111111111111111111111111111111111';
    const requirements = {
        ...createTestPaymentRequirements(recipient),
        amount: '10001', // 서버 한도 10000보다 최소 단위 1만큼 초과
    };
    const payment: PaymentPayload = {
        x402Version: 2,
        accepted: requirements,
        payload: { authorization: { value: '10001' } },
    };

    await expect(execute(payment, requirements)).rejects.toThrow('서버 건당 결제 한도를 초과했습니다.');
    expect(facilitator).not.toHaveBeenCalled();
});