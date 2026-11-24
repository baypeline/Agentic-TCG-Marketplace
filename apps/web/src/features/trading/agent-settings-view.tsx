'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import Link from 'next/link';
import styled from '@emotion/styled';
import { Button } from '../../components/ui';
import { formatUsdc, getCardDisplayName } from '../../lib/formatters';
import { previewCards } from './demo-cards';
import { useDemoTrading } from './demo-provider';
import { budgetSummary, parseUsdcInput, draftToPolicy, policyToDraft, validatePolicy, type PolicyDraft } from './demo-model';
import { Actions, ErrorText, Field, FormGrid, Metrics, PreviewPage, QuietButton, ResultNote, Section, StateBadge } from './trading-ui';

export function AgentSettingsView() {
  const { state, dispatch } = useDemoTrading();
  const [draft, setDraft] = useState(() => policyToDraft(state.policy));
  const [errors, setErrors] = useState<Partial<Record<keyof PolicyDraft, string>>>({});
  const [notice, setNotice] = useState('');
  const summary = useRef<HTMLDivElement>(null);
  const budget = budgetSummary(state);
  useEffect(() => { if (Object.keys(errors).length) summary.current?.focus(); }, [errors]);
  function change<K extends keyof PolicyDraft>(key: K, value: PolicyDraft[K]) { setDraft(current => ({ ...current, [key]: value })); setNotice(''); }
  function save(event: FormEvent) {
    event.preventDefault(); const nextErrors = validatePolicy(draft);
    const cap = parseUsdcInput(draft.totalBudget);
    if (cap && BigInt(cap) < BigInt(budget.spent) + BigInt(budget.reserved)) nextErrors.totalBudget = '사용 완료액과 결제 예약액보다 낮출 수 없어요.';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;
    const policy = draftToPolicy(draft); dispatch({ type: 'POLICY', policy }); setDraft(policyToDraft(policy)); setNotice('설정을 미리보기에 저장했어요. 서버에는 전송하지 않았어요.');
  }
  return <PreviewPage title="에이전트 설정" description="거래를 허용할 카드와 예산을 정해보세요. 아래 동작은 실제 Agent 실행이 아닌 화면 미리보기예요." actions={<Link href="/agent/logs">Agent 로그 보기</Link>}>
    <RunBar><div><strong>실행 상태</strong><StateBadge status={state.run} /></div><Actions><QuietButton type="button" disabled={!state.policy.enabled || state.run === 'RUNNING'} onClick={() => { dispatch({ type: 'RUN', run: 'RUNNING' }); setNotice('실행 중 화면으로 바꿨어요. 실제 Agent는 실행되지 않아요.'); }}>실행 미리보기</QuietButton><QuietButton type="button" disabled={state.run !== 'RUNNING'} onClick={() => { dispatch({ type: 'RUN', run: 'PAUSED' }); setNotice('일시중지 화면으로 바꿨어요.'); }}>일시중지</QuietButton><QuietButton type="button" disabled={state.run === 'IDLE'} onClick={() => { dispatch({ type: 'RUN', run: 'IDLE' }); setNotice('중지 후 대기 화면으로 바꿨어요.'); }}>중지</QuietButton></Actions></RunBar>
    <Metrics items={[{ label: '설정한 총예산', value: formatUsdc(state.policy.totalBudget) }, { label: '사용·예약 금액', value: formatUsdc((BigInt(budget.spent) + BigInt(budget.reserved)).toString()) }, { label: '남은 예산', value: formatUsdc(budget.remaining) }]} />
    <ResultNote>예시 사용 금액 {formatUsdc(budget.spent)} / 예약·결과 확인 중 {formatUsdc(budget.reserved)}. 입금은 사용 예산에 포함하지 않아요.</ResultNote>
    {budget.exceeded && <ErrorText role="status">예시 사용·예약 금액이 저장된 총예산을 초과했어요.</ErrorText>}
    <form onSubmit={save} noValidate>
      {Object.keys(errors).length > 0 && <ErrorSummary ref={summary} tabIndex={-1} role="alert"><strong>입력 내용을 확인해 주세요</strong><ul>{Object.entries(errors).map(([key, message]) => <li key={key}><a href={`#policy-${key}`}>{message}</a></li>)}</ul></ErrorSummary>}
      <Section><h2>예산과 거래 한도</h2><FormGrid>
        <Field id="policy-totalBudget" label="총예산 (USDC)" error={errors.totalBudget}><input id="policy-totalBudget" inputMode="decimal" value={draft.totalBudget} onChange={e => change('totalBudget', e.target.value)} aria-invalid={Boolean(errors.totalBudget)} aria-describedby={errors.totalBudget ? 'policy-totalBudget-error' : undefined} /></Field>
        <Field id="policy-maxPerTrade" label="1회 거래 한도 (USDC)" error={errors.maxPerTrade}><input id="policy-maxPerTrade" inputMode="decimal" value={draft.maxPerTrade} onChange={e => change('maxPerTrade', e.target.value)} aria-invalid={Boolean(errors.maxPerTrade)} aria-describedby={errors.maxPerTrade ? 'policy-maxPerTrade-error' : undefined} /></Field>
        <Field id="policy-minDiscountPercent" label="적정가 대비 최소 할인율 (%)" error={errors.minDiscountPercent} hint="실제 적정가가 확인된 거래에 적용할 조건이에요."><input id="policy-minDiscountPercent" inputMode="decimal" value={draft.minDiscountPercent} onChange={e => change('minDiscountPercent', e.target.value)} aria-invalid={Boolean(errors.minDiscountPercent)} aria-describedby={errors.minDiscountPercent ? 'policy-minDiscountPercent-error' : 'policy-minDiscountPercent-hint'} /></Field>
        <Field id="policy-validUntil" label="정책 유효 날짜 (UTC 기준)" error={errors.validUntil}><input id="policy-validUntil" type="date" value={draft.validUntil} onChange={e => change('validUntil', e.target.value)} aria-invalid={Boolean(errors.validUntil)} aria-describedby={errors.validUntil ? 'policy-validUntil-error' : undefined} /></Field>
      </FormGrid></Section>
      <Section><h2>거래 허용 범위</h2><CardChoices id="policy-allowedCardVariantIds" tabIndex={-1} aria-describedby={errors.allowedCardVariantIds ? 'policy-allowedCardVariantIds-error' : undefined}><legend>거래할 수 있는 카드</legend>{previewCards.map(card => <label key={card.id}><input type="checkbox" checked={draft.allowedCardVariantIds.includes(card.id)} onChange={e => change('allowedCardVariantIds', e.target.checked ? [...draft.allowedCardVariantIds, card.id] : draft.allowedCardVariantIds.filter(id => id !== card.id))} />{getCardDisplayName(card)}</label>)}</CardChoices>{errors.allowedCardVariantIds && <ErrorText id="policy-allowedCardVariantIds-error">{errors.allowedCardVariantIds}</ErrorText>}
        <Enabled><input type="checkbox" checked={draft.enabled} onChange={e => change('enabled', e.target.checked)} />이 정책으로 Agent 거래 허용</Enabled><ResultNote>실행 미리보기는 저장된 설정을 기준으로 표시해요. 정책을 끄고 저장하면 일시중지 상태로 바뀝니다.</ResultNote>
      </Section>
      <Actions><Button type="submit">설정 저장 (미리보기)</Button><QuietButton type="button" onClick={() => { setDraft(policyToDraft(state.policy)); setErrors({}); setNotice('마지막으로 저장한 설정을 불러왔어요.'); }}>수정 취소</QuietButton></Actions>
    </form><ResultNote role="status">{notice}</ResultNote>
  </PreviewPage>;
}

const RunBar = styled.div(({ theme }) => ({ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 16, marginBottom: 28, padding: '0 0 24px', borderBottom: `1px solid ${theme.color.line}`, '& > div:first-of-type': { display: 'flex', alignItems: 'center', gap: 16 }, '& strong': { fontSize: 14, fontWeight: 550 } }));
const ErrorSummary = styled.div(({ theme }) => ({ border: `1px solid ${theme.color.error}`, borderRadius: 6, padding: 16, fontSize: 14, '& ul': { marginBottom: 0 }, '& a': { color: theme.color.error } }));
const CardChoices = styled.fieldset(({ theme }) => ({ margin: 0, padding: '12px 0', border: 0, '& legend': { fontSize: 14 }, '& label': { display: 'inline-flex', alignItems: 'center', gap: 10, minHeight: 44, marginRight: 24, fontSize: 14 }, '& input': { width: 18, height: 18, accentColor: theme.color.primary } }));
const Enabled = styled.label(({ theme }) => ({ display: 'flex', alignItems: 'center', gap: 12, minHeight: 48, marginTop: 16, fontSize: 14, '& input': { width: 18, height: 18, accentColor: theme.color.primary } }));
