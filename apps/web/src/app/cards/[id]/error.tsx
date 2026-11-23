'use client';
import { RequestState } from '../../../components/request-state';
export default function CardError({ reset }: { reset: () => void }) { return <RequestState title="카드 정보를 불러오지 못했습니다." message="잠시 후 다시 시도하거나 카드 목록에서 다시 선택하세요." onRetry={reset} />; }
