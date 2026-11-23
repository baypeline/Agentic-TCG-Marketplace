import { cardVariantSchema, type CardVariant } from '@tcg/contracts';

type CardRow = Omit<CardVariant, 'game' | 'imageUrl' | 'localizedNames'> & {
  game: string;
  imageUrl: string | null;
  localizedNames: { locale: string; name: string; source: string; sourceUrl: string }[];
};
export function toCardVariant(row: CardRow): CardVariant {
  const localizedNames = row.localizedNames.filter(name => name.locale === 'ko' && name.source === 'POKEAPI_SPECIES');
  return cardVariantSchema.parse({ ...row, imageUrl: row.imageUrl ?? undefined, localizedNames: localizedNames.length ? localizedNames : undefined });
}
