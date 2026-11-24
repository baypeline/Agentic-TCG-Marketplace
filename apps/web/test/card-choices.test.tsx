import { expect, it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { CardChoices, cardChoiceQuestion } from '../src/features/chat/card-choices';
import { renderUI } from './render';

it('텍스트 번호 대신 식별 속성이 담긴 질문을 만들고 선택·대기 상태를 버튼으로 표시한다', () => {
  const card = demoCards[0]!;
  const question = cardChoiceQuestion(card);
  for (const field of ['id', 'name', 'setCode', 'cardNumber', 'language', 'edition', 'condition'] as const) {
    expect(question).toContain(JSON.stringify(card[field]));
  }
  const html = renderUI(<CardChoices cards={[card]} disabled={false} selectedId={card.id} onSelect={() => {}} />);
  expect(html).toContain('aria-pressed="true"');
  expect(html).toContain('disabled=""');
  expect(html).toContain('선택한 카드');
  const waiting = renderUI(<CardChoices cards={[card]} disabled onSelect={() => {}} />);
  expect(waiting).toContain('disabled=""');
});
