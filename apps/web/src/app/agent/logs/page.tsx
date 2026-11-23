import type { Metadata } from 'next';
import { AgentLogsView } from '../../../features/trading/agent-logs-view';
export const metadata: Metadata = { title: 'Agent 로그' };
export default function AgentLogsPage() { return <AgentLogsView />; }
