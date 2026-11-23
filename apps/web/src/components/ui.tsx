'use client';

import type { ComponentProps, ReactNode } from 'react';
import Link from 'next/link';
import styled from '@emotion/styled';
import isPropValid from '@emotion/is-prop-valid';

export type Tone = 'neutral' | 'warning' | 'success' | 'error' | 'demo';
export function Badge({ children, tone = 'neutral' }: { children: ReactNode; tone?: Tone }) { return <BadgeRoot tone={tone}>{children}</BadgeRoot>; }
export function Button(props: ComponentProps<'button'>) { return <ButtonRoot {...props} />; }
export function ActionLink(props: ComponentProps<typeof Link>) { return <ActionRoot {...props} />; }
export function Notice({ title, children, tone = 'neutral' }: { title: string; children?: ReactNode; tone?: Tone }) {
  return <NoticeRoot tone={tone}><strong>{title}</strong>{children && <div>{children}</div>}</NoticeRoot>;
}

const BadgeRoot = styled('span', { shouldForwardProp: prop => isPropValid(prop) && prop !== 'tone' })<{ tone: Tone }>(({ theme, tone }) => ({
  display: 'inline-flex', alignItems: 'center', padding: '3px 8px', borderRadius: theme.radius.badge,
  fontSize: 12, fontWeight: 650, lineHeight: 1.6, maxWidth: '100%',
  color: tone === 'neutral' ? theme.color.ink : theme.color[tone],
  background: tone === 'neutral' ? theme.color.mat : theme.color[`${tone}Bg`],
}));
const ButtonRoot = styled.button(({ theme }) => ({
  minHeight: 48, padding: '10px 24px', border: 0, borderRadius: theme.radius.control,
  background: theme.color.primary, color: theme.color.surface, fontWeight: 700,
  '&:hover:not(:disabled)': { background: theme.color.primaryHover }, '&:disabled': { opacity: .65 },
}));
const ActionRoot = styled(Link)(({ theme }) => ({
  display: 'inline-flex', justifyContent: 'center', alignItems: 'center', minHeight: 44, padding: '8px 16px',
  color: theme.color.link, background: theme.color.surface, border: `1px solid ${theme.color.input}`,
  borderRadius: theme.radius.control, textDecoration: 'none', fontWeight: 650,
  '&:hover': { background: theme.color.soft },
}));
const NoticeRoot = styled('div', { shouldForwardProp: prop => isPropValid(prop) && prop !== 'tone' })<{ tone: Tone }>(({ theme, tone }) => ({
  padding: 16, borderRadius: theme.radius.panel, fontSize: 14,
  color: tone === 'neutral' ? theme.color.ink : theme.color[tone],
  background: tone === 'neutral' ? theme.color.lavenderSoft : theme.color[`${tone}Bg`],
  '& strong': { display: 'block', marginBottom: 4 },
}));
