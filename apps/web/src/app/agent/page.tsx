import { LiveTradingStatus } from '../../features/trading/live-status';
import type { Metadata } from 'next';
import { AgentSettingsView } from '../../features/trading/agent-settings-view';
export const metadata: Metadata = { title: '에이전트 설정' };
export default function AgentPage() { return <><LiveTradingStatus /><AgentSettingsView /></>; }
