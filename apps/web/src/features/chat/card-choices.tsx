'use client';

import styled from '@emotion/styled';
import type { CardVariant } from '@tcg/contracts';
import { CardImage } from '../../components/card-image';
import { formatAttribute, formatSet, getCardDisplayName } from '../../lib/formatters';

export function cardChoiceQuestion(card: CardVariant) {
  return `선택한 카드의 적정가를 조회해 주세요. 다음 식별 정보와 정확히 일치하는 카드를 검색한 뒤 조회하세요: ${JSON.stringify({ id: card.id, name: card.name, setCode: card.setCode, cardNumber: card.cardNumber, language: card.language, edition: card.edition, condition: card.condition })}`;
}

export function cardChoiceLabel(card: CardVariant) {
  const language = ({ EN: '영문판', KO: '한국어판', JA: '일본어판' } as Record<string, string>)[card.language] ?? card.language;
  return `${getCardDisplayName(card)} · ${formatSet(card.setCode)} ${card.cardNumber} · ${language}`;
}

export function CardChoices({ cards, disabled, selectedId, onSelect }: { cards: CardVariant[]; disabled: boolean; selectedId?: string; onSelect: (card: CardVariant) => void }) {
  return <Choices role="group" aria-label="적정가를 조회할 카드 선택"><Hint>카드를 누르면 해당 카드의 적정가를 조회해요.</Hint>{cards.map(card => <Choice key={card.id} type="button" disabled={disabled || selectedId === card.id} aria-pressed={selectedId === card.id} onClick={() => onSelect(card)}><Thumbnail><CardImage card={card} variant="thumbnail" /></Thumbnail><ChoiceText><strong>{cardChoiceLabel(card)}</strong><small>판본 {formatAttribute(card.edition)} · 상태 {formatAttribute(card.condition)}</small><Action>{selectedId === card.id ? '선택한 카드' : '이 카드 적정가 조회'}</Action></ChoiceText></Choice>)}</Choices>;
}

const Choices = styled.div({ display: 'grid', gap: 10, marginTop: 16 });
const Hint = styled.p(({ theme }) => ({ fontSize: 12, color: theme.color.muted, lineHeight: 1.7 }));
const Choice = styled.button(({ theme }) => ({ display: 'flex', alignItems: 'center', gap: 12, textAlign: 'left', width: '100%', minHeight: 72, padding: 12, border: `1px solid ${theme.color.input}`, borderRadius: theme.radius.control, background: theme.color.surface, color: theme.color.ink, '&:hover:not(:disabled),&:focus-visible': { borderColor: theme.color.primary, background: theme.color.soft }, '&[aria-pressed=true]': { borderColor: theme.color.primary, background: theme.color.soft }, '&:disabled': { cursor: 'default' }, '&:disabled:not([aria-pressed=true])': { opacity: .55 } }));
const Thumbnail = styled.span({ display: 'block', width: 34, flexShrink: 0 });
const ChoiceText = styled.span(({ theme }) => ({ display: 'block', minWidth: 0, overflowWrap: 'anywhere', '& strong': { display: 'block', fontWeight: 600, fontSize: 13, lineHeight: 1.7 }, '& small': { display: 'block', color: theme.color.muted, fontSize: 12, lineHeight: 1.7, marginTop: 2 } }));
const Action = styled.span(({ theme }) => ({ display: 'block', color: theme.color.link, fontSize: 12, marginTop: 6 }));
