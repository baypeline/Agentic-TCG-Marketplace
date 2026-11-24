import { LiveTradingWorkspace } from '../../features/trading/live-workspace';
import type { Metadata } from 'next';
import { AgentSettingsView } from '../../features/trading/agent-settings-view';
export const metadata: Metadata = { title: '에이전트 설정' };
export default async function Page({ searchParams }: { searchParams: Promise<{ preview?: string }> }) {
  const { preview } = await searchParams;
  return preview === '1' ? <AgentSettingsView /> : <LiveTradingWorkspace mode="agent" />;
}
