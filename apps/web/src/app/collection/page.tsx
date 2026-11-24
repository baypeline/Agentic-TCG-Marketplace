import { LiveTradingWorkspace } from '../../features/trading/live-workspace';
import type { Metadata } from 'next';
import { CollectionView } from '../../features/trading/collection-view';
export const metadata: Metadata = { title: '내 카드' };
export default async function Page({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  return preview === '1' ? <CollectionView /> : <LiveTradingWorkspace mode="collection" />;
}
