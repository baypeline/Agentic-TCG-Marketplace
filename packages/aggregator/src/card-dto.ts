import { cardVariantSchema, type CardVariant } from '@tcg/contracts';

type CardRow = Omit<CardVariant, 'game' | 'imageUrl' | 'localizedNames'> & {
  game: string;
  imageUrl: string | null;
  localizedNames: { locale: string; name: string; source: string; sourceUrl: string }[];
  imageReference?: {provider:string;officialCardId:string;sourceUrl:string;productName:string;printedNumber:string;verifiedAt:Date;imageUrl:string;setCode:string;cardNumber:string;name:string} | null;
};
export function toCardVariant(row: CardRow): CardVariant {
  const localizedNames = row.localizedNames.filter(name => name.locale === 'ko' && name.source === 'POKEAPI_SPECIES');
  const ref=row.imageReference;
  const verified=ref&&ref.provider==='POKEMON_KOREA'&&row.language==='KO'&&ref.imageUrl===row.imageUrl&&ref.setCode===row.setCode&&ref.cardNumber===row.cardNumber&&ref.name===row.name;
  const imageSource=verified?{provider:ref.provider,officialCardId:ref.officialCardId,sourceUrl:ref.sourceUrl,productName:ref.productName,printedNumber:ref.printedNumber,verifiedAt:ref.verifiedAt.toISOString()}:undefined;
  return cardVariantSchema.parse({ ...row, imageUrl: row.imageUrl ?? undefined, localizedNames: localizedNames.length ? localizedNames : undefined,imageSource,catalogRole:verified&&(row.edition==='UNSPECIFIED'||row.condition==='UNSPECIFIED')?'REFERENCE':undefined });
}
