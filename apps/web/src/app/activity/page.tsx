import { LiveTradingStatus } from '../../features/trading/live-status';
import type { Metadata } from 'next';
import { ActivityView, type ActivityTab } from '../../features/trading/activity-view';
export const metadata: Metadata = { title: '거래 관리' };
export default async function ActivityPage({ searchParams }: { searchParams: Promise<{ view?: string | string[] }> }) {
  const { view } = await searchParams;
  const selected: ActivityTab = view === 'payments' || view === 'trades' ? view : 'orders';
  return <><LiveTradingStatus /><ActivityView view={selected} /></>;
}
