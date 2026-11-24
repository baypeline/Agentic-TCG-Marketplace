import { expect, it } from 'vitest';
import type { InventoryItem } from '@tcg/contracts';
import { demoCards } from '@tcg/contracts/fixtures';
import { LiveCollection } from '../src/features/trading/live-collection';
import { renderUI } from './render';

const card = { ...demoCards[0]!, imageUrl: 'https://assets.tcgdex.net/en/base/base1/58/high.webp' };
const item: InventoryItem = { id: '00000000-0000-4000-8200-000000000001', ownerId: '00000000-0000-4000-8200-000000000002', cardVariantId: card.id, status: 'AVAILABLE' };

it('서버 카드 이미지와 판본 정보를 표시하고 판매 폼은 접힌 상태로 제공한다', () => {
  const html = renderUI(<LiveCollection items={[item]} cards={[card]} renderSale={() => <form aria-label="판매 가격 설정" />} />);
  expect(html).toContain(`src="${card.imageUrl}"`);
  expect(html).toContain('피카츄 상세 보기');
  expect(html).toContain('영어판');
  expect(html).toContain('NORMAL');
  expect(html).toContain('NM');
  expect(html).toContain('판매 가격 설정');
  expect(html).toMatch(/<details[^>]*>/);
  expect(html).not.toMatch(/<details[^>]*\sopen(?:=|\s|>)/);
  expect(html).toContain('href="/marketplace?owner=me"');
});

it.each(['LISTED', 'RESERVED'] as const)('소유 상태 %s에서는 새 판매 폼을 제공하지 않는다', status => {
  const html = renderUI(<LiveCollection items={[{ ...item, status }]} cards={[card]} renderSale={() => <form aria-label="판매 가격 설정" />} />);
  expect(html).not.toContain('판매 가격 설정');
  expect(html).toContain(status === 'LISTED' ? '매물 관리' : '결제 결과를 기다려');
});

it('보유 카드가 없거나 이미지가 없어도 다음 행동과 카드 정보를 표시한다', () => {
  const empty = renderUI(<LiveCollection items={[]} cards={[]} renderSale={() => null} />);
  expect(empty).toContain('href="/cards"');
  const missingImage = renderUI(<LiveCollection items={[item]} cards={demoCards} renderSale={() => null} />);
  expect(missingImage).toContain('이미지 없음');
  expect(missingImage).toContain('피카츄');
});
