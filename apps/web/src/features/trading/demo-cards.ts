import type { CardVariant } from '@tcg/contracts';

// 수집된 카드 메타데이터의 화면용 발췌본. 거래 금액·보유·주문 기록은 별도 합성 예시입니다.

export const previewCards: CardVariant[] = [
  {
    "id": "78620e14-6cce-44ff-b7b0-ba417648f5d5",
    "game": "POKEMON",
    "name": "Pikachu",
    "setCode": "base1",
    "cardNumber": "58",
    "language": "EN",
    "edition": "UNSPECIFIED",
    "condition": "UNSPECIFIED",
    "imageUrl": "https://assets.tcgdex.net/en/base/base1/58/high.webp",
    "localizedNames": [
      {
        "locale": "ko",
        "name": "피카츄",
        "source": "POKEAPI_SPECIES",
        "sourceUrl": "https://raw.githubusercontent.com/PokeAPI/pokeapi/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv"
      }
    ]
  },
  {
    "id": "56f950b8-c92f-4fb2-ae42-38897d072846",
    "game": "POKEMON",
    "name": "Charizard",
    "setCode": "base1",
    "cardNumber": "4",
    "language": "EN",
    "edition": "UNSPECIFIED",
    "condition": "UNSPECIFIED",
    "imageUrl": "https://assets.tcgdex.net/en/base/base1/4/high.webp",
    "localizedNames": [
      {
        "locale": "ko",
        "name": "리자몽",
        "source": "POKEAPI_SPECIES",
        "sourceUrl": "https://raw.githubusercontent.com/PokeAPI/pokeapi/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv"
      }
    ]
  },
  {
    "id": "08bd31e8-2981-46d9-af01-b0538b7cef20",
    "game": "POKEMON",
    "name": "Eevee",
    "setCode": "base2",
    "cardNumber": "51",
    "language": "EN",
    "edition": "UNSPECIFIED",
    "condition": "UNSPECIFIED",
    "imageUrl": "https://assets.tcgdex.net/en/base/base2/51/high.webp",
    "localizedNames": [
      {
        "locale": "ko",
        "name": "이브이",
        "source": "POKEAPI_SPECIES",
        "sourceUrl": "https://raw.githubusercontent.com/PokeAPI/pokeapi/cd5f6c6232f23430aa6089896d96230f5f7ecef4/data/v2/csv/pokemon_species_names.csv"
      }
    ]
  }
];
