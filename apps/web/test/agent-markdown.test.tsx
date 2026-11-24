import { expect, it } from 'vitest';
import AgentMarkdown from '../src/features/chat/agent-markdown';
import { renderUI } from './render';

it('에이전트 답변의 강조, 목록, 링크, 코드, 표를 렌더링한다', () => {
  const html = renderUI(<AgentMarkdown content={[
    '### 피카츄',
    '',
    '- **적정가**는 `12 USDC`입니다.',
    '- [카드 보기](/cards)',
    '',
    '```json',
    '{"price":12}',
    '```',
    '',
    '| 구분 | 가격 |',
    '| --- | --- |',
    '| Mock | 12 USDC |',
  ].join('\n')} />);

  expect(html).toContain('<h3>피카츄</h3>');
  expect(html).toContain('<ul>');
  expect(html).toContain('<strong>적정가</strong>');
  expect(html).toContain('<code>12 USDC</code>');
  expect(html).toContain('<a href="/cards">카드 보기</a>');
  expect(html).toContain('<pre><code class="language-json">');
  expect(html).toContain('<table>');
  expect(html).toContain('<td>12 USDC</td>');
});

it('답변에 포함된 원시 HTML과 스크립트 링크가 실행되지 않도록 한다', () => {
  const html = renderUI(<AgentMarkdown content={[
    '<script>alert(1)</script>',
    '<img src=x onerror="alert(1)">',
    '',
    '[링크](javascript:alert%281%29)',
  ].join('\n')} />);

  expect(html).toContain('링크');
  expect(html).not.toContain('<script');
  expect(html).not.toContain('<img');
  expect(html).not.toContain('javascript:');
});
