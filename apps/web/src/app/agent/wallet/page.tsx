import type { Metadata } from 'next';
import { AgentWalletSetup } from '../../../features/auth/agent-wallet-setup';

export const metadata: Metadata = { title: '에이전트 지갑 설정' };
export default function AgentWalletPage() { return <AgentWalletSetup />; }
