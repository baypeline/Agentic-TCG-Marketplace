import { getPaymentProfile, type PaymentChain } from '@tcg/contracts/payment-profile';
import type { PrismaClient } from './generated/prisma/client.js';

export async function ensureMonetaryContext(prisma: PrismaClient, chain: PaymentChain) {
  const profile = getPaymentProfile(chain);
  await prisma.$transaction(async tx => {
    const context = await tx.monetaryContext.findUnique({ where: { id: 'settlement' } });
    if (context) {
      if (context.chain !== chain || context.currency !== profile.currency || context.decimals !== profile.decimals) throw new Error('거래 DB의 통화·체인과 실행 설정이 다릅니다. 기존 원장을 재해석하지 않습니다.');
      return;
    }
    if (chain === 'maroo') {
      const [prices, listings, trades, payments, policies] = await Promise.all([tx.priceObservation.count(), tx.listing.count(), tx.trade.count(), tx.paymentAttempt.count(), tx.spendingPolicy.count()]);
      if (prices + listings + trades + payments + policies > 0) throw new Error('기존 금액 데이터가 있는 DB를 tOKRW로 전환할 수 없습니다. 별도 DB를 사용하세요.');
    }
    const saved = await tx.monetaryContext.upsert({ where: { id: 'settlement' }, create: { id: 'settlement', chain, currency: profile.currency, decimals: profile.decimals }, update: {} });
    if (saved.chain !== chain || saved.currency !== profile.currency || saved.decimals !== profile.decimals) throw new Error('다른 통화의 DB 초기화가 먼저 완료되어 중단했습니다.');
  });
}
