import { expect, it } from 'vitest';
import { demoCards } from '@tcg/contracts/fixtures';
import { CatalogView } from '../src/features/catalog/catalog-view';
import { DetailView } from '../src/features/card-detail/detail-view';
import { renderUI } from './render';

it('공식 한국어판 정보 카드는 이미지·출처를 보여주고 빈 가격을 조회 실패나 0원으로 표시하지 않는다', () => {
  const card = { ...demoCards[0]!, name: '로젤리아', localizedNames: undefined, language: 'KO', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED', catalogRole: 'REFERENCE' as const,
    imageUrl: 'https://pokemoncard.co.kr/public-assets/home/data/cards.image_www/data/wmimages/SV/SV5K/SV5K_001.webp?w=512',
    imageSource: { provider: 'POKEMON_KOREA' as const, officialCardId: 'BS2024004001', sourceUrl: 'https://pokemoncard.co.kr/cards/detail/BS2024004001', productName: '와일드포스', printedNumber: '001/071', verifiedAt: '2026-11-28T00:00:00.000Z' } };
  const catalog = renderUI(<CatalogView query="" items={[{ card, valuation: null, prices: null, valuationFailed: false, pricesFailed: false }]} />);
  expect(catalog).toContain('카드 정보 보기');
  expect(catalog).not.toContain('가격 조회 실패');
  const detail = renderUI(<DetailView card={card} valuation={null} prices={null} query="" />);
  expect(detail).toContain(card.imageSource.sourceUrl);
  expect(detail).toContain('SV5K_001.webp');
  expect(detail).toContain('001/071');
  expect(detail).not.toContain('가격 조회 실패');
  expect(detail).not.toContain('0 USDC');
  expect(detail).not.toContain('보존 상태');
});
