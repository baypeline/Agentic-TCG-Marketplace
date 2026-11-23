import { notFound } from 'next/navigation';
import { idSchema } from '@tcg/contracts';
import { CoreApiError, getCardVariant, getValuation, getMarketPrices, searchCards } from '../../../server/api';
import { sameNameCards } from '../../../lib/discovery';
import { DetailView } from '../../../features/card-detail/detail-view';

export const dynamic = 'force-dynamic';
export default async function CardDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ q?: string | string[] }> }) {
  const { id } = await params; const search = await searchParams;
  const query = typeof search.q === 'string' ? search.q.trim().slice(0, 200) : '';
  if (!idSchema.safeParse(id).success) notFound();
  let card;
  try { card = await getCardVariant(id); }
  catch (error) { if (error instanceof CoreApiError && error.status === 404) notFound(); throw error; }
  const [valuation, prices, related] = await Promise.allSettled([getValuation(id), getMarketPrices(id), searchCards(card.name)]);
  const candidates = related.status === 'fulfilled' ? sameNameCards(related.value.items, card.name, card.id) : [];
  const illustrated = candidates.filter(item => item.imageUrl);
  return <DetailView card={card} query={query} valuation={valuation.status === 'fulfilled' ? valuation.value : null} prices={prices.status === 'fulfilled' ? prices.value : null} related={(illustrated.length ? illustrated : candidates).slice(0, 3)} relatedFailed={related.status === 'rejected'} />;
}
