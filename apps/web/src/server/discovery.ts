import 'server-only';
import { searchCards, getMarketPrices } from './api';
import type { DiscoveryData } from '../lib/discovery';

export async function getDiscovery(): Promise<DiscoveryData> {
  let cards;
  try { cards = (await searchCards('')).items; }
  catch { return { spotlight: [], family: [], spotlightFailed: true, familyFailed: true }; }
  const unique = cards.filter((card, index) => cards.findIndex(item => item.id === card.id) === index);
  const spotlight = await Promise.all(unique.slice(0, 2).map(async card => {
    try { return { card, prices: await getMarketPrices(card.id), pricesFailed: false }; }
    catch { return { card, prices: null, pricesFailed: true }; }
  }));
  return { spotlight, family: unique.slice(2, 6), spotlightFailed: false, familyFailed: false };
}
