import { LiveTradingWorkspace } from '../../features/trading/live-workspace';
import type { Metadata } from 'next';
import { MarketplaceView } from '../../features/trading/marketplace-view';
export const metadata: Metadata = { title: '고정가 매물' };
export default async function MarketplacePage({ searchParams }: { searchParams: Promise<{ owner?: string | string[]; preview?: string }> }) {
  const { owner, preview } = await searchParams;
  const initialOwner = owner === 'me' ? 'MINE' : 'ALL';
  if (preview !== '1') return <LiveTradingWorkspace mode="marketplace" mine={owner === 'me'} />;
  return <MarketplaceView key={initialOwner} initialOwner={initialOwner} />;
}
