import { expect, it } from 'vitest';
import { AgentWalletFundingCard } from '../src/features/auth/agent-wallet-status';
import { createAgentWalletSetupStore, needsAgentWalletSetup } from '../src/stores/agent-wallet-setup';
import { renderUI } from './render';
import { agentWalletInfoSchema } from '@tcg/contracts';

const user = { userId: '00000000-0000-4000-8000-000000000001', agentWalletLinked: true, agentWalletAddress: `0x${'3'.repeat(40)}` };
const info = agentWalletInfoSchema.parse({ address: user.agentWalletAddress, chainId: 450815, network: 'Maroo Testnet', currency: 'tOKRW', decimals: 18, balance: '100000000000000000000', balanceUpdatedAt: '2026-11-28T00:00:00.000Z', createdAt: '2026-11-28T00:00:00.000Z' });
it('자동 발급 지갑의 첫 충전 안내는 사용자별로 기억하고 연결 상태를 저장하지 않는다', async () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; }, removeItem: () => { saved = null; } };
  const store = createAgentWalletSetupStore(storage);
  expect(needsAgentWalletSetup(user, [])).toBe(true);
  expect(needsAgentWalletSetup(null, [])).toBe(false);
  store.getState().markVisited(user.userId);
  const restored = createAgentWalletSetupStore(storage); await restored.persist.rehydrate();
  expect(needsAgentWalletSetup(user, restored.getState().visitedUsers)).toBe(false);
  expect(needsAgentWalletSetup({ ...user, userId: '00000000-0000-4000-8000-000000000003' }, restored.getState().visitedUsers)).toBe(true);
  expect(saved).not.toContain('agentWalletLinked');
});
it('생성된 주소·잔액·복사와 충전 안내를 표시하고 수동 생성 버튼을 제공하지 않는다', () => {
  const html = renderUI(<AgentWalletFundingCard info={info} loading={false} failed={false} onRefresh={() => undefined} />);
  for (const text of [info.address, '100 tOKRW', 'Maroo Testnet', '주소 복사', '가스비', '별도로']) expect(html).toContain(text);
  expect(html).not.toContain('지갑 만들기');
  const unavailable = renderUI(<AgentWalletFundingCard info={{ ...info, balance: null }} loading={false} failed={false} onRefresh={() => undefined} />);
  expect(unavailable).toContain('잔액 조회 실패'); expect(unavailable).not.toContain('0 tOKRW');
  const empty = renderUI(<AgentWalletFundingCard info={{ ...info, balance: '0' }} loading={false} failed={false} onRefresh={() => undefined} />);
  expect(empty).toContain('0 tOKRW');
});
