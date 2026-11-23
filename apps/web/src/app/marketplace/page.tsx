import type { Metadata } from 'next';
import { MarketplaceView } from '../../features/trading/marketplace-view';
export const metadata: Metadata = { title: '고정가 매물' };
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ owner?: string | string[] }> }) {
  const { owner } = await searchParams;
  const initialOwner = owner === 'me' ? 'MINE' : 'ALL';
  return <MarketplaceView key={initialOwner} initialOwner={initialOwner} />;
}
