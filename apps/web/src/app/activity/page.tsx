import { LiveTradingWorkspace } from '../../features/trading/live-workspace';
import type { Metadata } from 'next';
import { ActivityView, type ActivityTab } from '../../features/trading/activity-view';
export const metadata: Metadata = { title: '거래 관리' };
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ view?: string | string[]; preview?: string }> }) {
  const { view, preview } = await searchParams;
  const selected: ActivityTab = view === 'payments' || view === 'trades' ? view : 'orders';
  return preview === '1' ? <ActivityView view={selected} /> : <LiveTradingWorkspace mode="activity" />;
}
