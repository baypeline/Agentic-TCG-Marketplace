import type { PurchaseStatus } from '@tcg/contracts';

export function describePurchase(status: PurchaseStatus, elapsedMs = 0) {
  if (status.paymentStatus === 'UNKNOWN') return { title: '결제 확인 중', detail: status.needsReview ? '운영자 확인 대상입니다. 카드와 예산을 보호하며 재결제하지 않습니다.' : '서버가 기존 결제 증빙을 확인하고 있습니다. 재결제하지 마세요.' };
  if (status.paymentStatus === 'PENDING') return { title: '결제 처리 중', detail: '제출된 결제를 보호하고 있습니다. 창을 닫아도 서버 확인은 계속됩니다.' };
  if (status.paymentStatus === 'SETTLED') return status.tradeStatus === 'COMPLETED' ? { title: '구매 완료', detail: '결제와 카드 소유권 이전이 완료됐습니다.' } : { title: '결제 완료 · 거래 처리 중', detail: status.needsReview ? '운영자 확인 대상입니다. 추가 결제 없이 소유권 이전을 복구합니다.' : '추가 결제 없이 서버가 카드 소유권 이전을 재시도합니다.' };
  if (status.paymentStatus === 'FAILED') return { title: '결제 실패 확정', detail: '카드 예약을 해제하고 결제 예약 예산을 반환합니다. 새 구매는 새 예약으로 진행하세요.' };
  if (status.quoteStatus === 'RELEASED') return { title: '예약 해제', detail: '예약이 종료됐습니다. 새 구매에는 새 예약이 필요합니다.' };
  const seconds = Math.max(0, Math.ceil((status.remainingMs-Math.max(0, elapsedMs))/1000));
  if (!seconds) return { title: '예약 만료', detail: '원래 예약 시간이 만료됐습니다. 새 구매에는 새 예약이 필요합니다.' };
  if (status.holdReasons.length) return { title: '결제 보류', detail: `${status.holdReasons.join(' ')} 예약은 유지되며 남은 시간은 ${seconds}초입니다. 정책을 조정하거나 예약을 취소하세요.` };
  return { title: '예약 유지 · 결제 승인 대기', detail: `남은 시간 ${seconds}초. 제출 전에 서버가 최신 정책과 예산을 다시 확인합니다.` };
}
