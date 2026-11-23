import { expect, it } from 'vitest';
import { formatUsdc, getCardDisplayName } from '../src/lib/formatters';
import { demoCards } from '@tcg/contracts/fixtures';

it('USDC 소수 6자리와 큰 값을 손실 없이 표시한다', () => {
  expect(formatUsdc('12500000')).toBe('12.5 USDC');
  expect(formatUsdc('1')).toBe('0.000001 USDC');
  expect(formatUsdc('0')).toBe('0 USDC');
  expect(formatUsdc('9007199254740993000001')).toBe('9,007,199,254,740,993.000001 USDC');
});
it('원문명·인쇄 언어를 변경하지 않고 한국어 표시 이름을 선택한다', () => {
  const card = { ...demoCards[0]!, localizedNames: [{ locale: 'ko' as const, name: '피카츄', source: 'POKEAPI_SPECIES' as const, sourceUrl: 'https://example.test/names.csv' }] };
  expect(getCardDisplayName(card)).toBe('피카츄');
  expect(card.name).toBe('Pikachu');
  expect(card.language).toBe('EN');
});
it('한국어 이름이 없으면 원문 이름으로 표시한다', () => {
  expect(getCardDisplayName({ ...demoCards[0]!, localizedNames: undefined })).toBe('Pikachu');
});
