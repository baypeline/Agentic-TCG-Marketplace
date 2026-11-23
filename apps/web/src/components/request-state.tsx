'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import styled from '@emotion/styled';
import { Button, ActionLink } from './ui';

export function RequestState({ title, message, onRetry, compact = false, backHref = '/cards' }: { title: string; message: string; onRetry?: () => void; compact?: boolean; backHref?: string }) {
  const router = useRouter(); const [pending, startTransition] = useTransition();
  return <State data-compact={compact || undefined}>{compact ? <h2>{title}</h2> : <h1>{title}</h1>}<p role="alert">{message}</p><Actions><Button disabled={pending} onClick={() => startTransition(() => { if (onRetry) onRetry(); else router.refresh(); })}>{pending ? '확인 중…' : '다시 시도'}</Button>{!compact && <ActionLink href={backHref}>카드 목록으로 돌아가기</ActionLink>}</Actions></State>;
}
export function NotFoundState() {
  return <State><h1>카드를 찾을 수 없습니다.</h1><p>카드 주소를 확인하거나 목록에서 다시 선택하세요.</p><ActionLink href="/cards">카드 목록으로 돌아가기</ActionLink></State>;
}
export function CatalogLoading() {
  return <Loading aria-busy="true"><h1>불러오는 중</h1><p role="status">카드 정보를 불러오고 있습니다…</p><SkeletonGrid aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} />)}</SkeletonGrid></Loading>;
}

const State = styled.section(({ theme }) => ({ padding: '48px 24px', background: theme.color.surface, borderRadius: theme.radius.panel, border: `1px solid ${theme.color.line}`, '& h1,& h2': { fontSize: 26 }, '& p': { margin: '16px 0 24px', color: theme.color.muted }, '&[data-compact]': { padding: 24, '& h2': { fontSize: 20 } } }));
const Actions = styled.div({ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' });
const Loading = styled.section(({ theme }) => ({ '& h1': { fontSize: 30 }, '& p': { marginTop: 12, color: theme.color.muted } }));
const SkeletonGrid = styled.div(({ theme }) => ({ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 24, padding: 24, background: theme.color.mat, borderRadius: theme.radius.mat, marginTop: 28, '@media(max-width:639px)': { gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: 12, padding: 12 } }));
const Skeleton = styled.div(({ theme }) => ({ height: 360, borderRadius: theme.radius.card, background: theme.color.surface, '@media(max-width:639px)': { height: 260 } }));
