import 'server-only';
import { searchCards, getMarketPrices } from './api';
import { sameNameCards, type DiscoveryData } from '../lib/discovery';

export async function getDiscovery(): Promise<DiscoveryData> {
  const names = ['Pikachu', 'Eevee', 'Vaporeon', 'Jolteon', 'Flareon'];
  const results = await Promise.allSettled(names.map(searchCards));
  const lead = results[0]!;
  const cards = lead.status === 'fulfilled' ? sameNameCards(lead.value.items, 'Pikachu').slice(0, 2) : [];
  const spotlight = await Promise.all(cards.map(async card => {
    try { return { card, prices: await getMarketPrices(card.id), pricesFailed: false }; }
    catch { return { card, prices: null, pricesFailed: true }; }
  }));
  const family = results.slice(1).flatMap((result, index) => {
    if (result.status === 'rejected') return [];
    const card = sameNameCards(result.value.items, names[index + 1]!)[0];
    return card ? [card] : [];
  });
  return { spotlight, family, spotlightFailed: lead.status === 'rejected', familyFailed: results.slice(1).some(result => result.status === 'rejected') };
}
