import { expect, it } from 'vitest';
import { AgentWalletSetupView } from '../src/features/auth/agent-wallet-setup';
import { createAgentWalletSetupStore, needsAgentWalletSetup } from '../src/stores/agent-wallet-setup';
import { renderUI } from './render';
import { demoStatusSchema } from '@tcg/contracts';

const user = { userId: '00000000-0000-4000-8000-000000000001', agentId: '00000000-0000-4000-8000-000000000002', address: `0x${'1'.repeat(40)}`, expiresAt: '2099-01-01T00:00:00.000Z', agentWalletLinked: false };
const payer = `0x${'3'.repeat(40)}`;
const demo = demoStatusSchema.parse({ enabled: true, paymentEnabled: true, currency: 'tOKRW', paymentChain: 'maroo', payer, recipient: null, suggestions: [] });

it('첫 안내의 확인 여부는 계정별로 기억하고 연결 상태는 서버 응답에서만 판단한다', async () => {
  let saved: string | null = null;
  const storage = { getItem: () => saved, setItem: (_key: string, value: string) => { saved = value; }, removeItem: () => { saved = null; } };
  const store = createAgentWalletSetupStore(storage);
  expect(needsAgentWalletSetup(user, store.getState().visitedUsers)).toBe(true);
  expect(needsAgentWalletSetup(null, [])).toBe(false);
  expect(needsAgentWalletSetup({ ...user, agentWalletLinked: true }, [])).toBe(false);
  store.getState().markVisited(user.userId);
  const restored = createAgentWalletSetupStore(storage); await restored.persist.rehydrate();
  expect(needsAgentWalletSetup(user, restored.getState().visitedUsers)).toBe(false);
  expect(needsAgentWalletSetup({ ...user, userId: '00000000-0000-4000-8000-000000000003' }, restored.getState().visitedUsers)).toBe(true);
  expect(saved).not.toContain('agentWalletLinked');
  saved = JSON.stringify({ state: { visitedUsers: [null, 'bad-id', user.userId, user.userId], markVisited: 'invalid' }, version: 1 });
  await restored.persist.rehydrate(); expect(restored.getState().visitedUsers).toEqual([user.userId]);
  expect(typeof restored.getState().markVisited).toBe('function');
});
it('미연결 계정에는 생성 준비 상태와 건너뛰기를 제공하며 공통 지갑 주소를 자신의 지갑으로 표시하지 않는다', () => {
  const html = renderUI(<AgentWalletSetupView user={user} demo={demo} onRefresh={() => undefined} />);
  expect(html).toContain('미연결'); expect(html).toContain('지갑 생성·연결 기능을 준비');
  expect(html).toMatch(/disabled=""[^>]*>전용 지갑 만들기/);
  expect(html).toContain('나중에 하고 카드 둘러보기'); expect(html).toContain('href="/agent"');
  expect(html).toContain('Maroo Testnet'); expect(html).not.toContain(payer);
});
it('연결된 계정은 실제 지급 주소를 보여주고 조회 실패나 비로그인을 별도로 안내한다', () => {
  const linked = { ...user, agentWalletLinked: true };
  const html = renderUI(<AgentWalletSetupView user={linked} demo={demo} onRefresh={() => undefined} />);
  expect(html).toContain(payer); expect(html).toContain('주소 복사'); expect(html).not.toContain('전용 지갑 만들기');
  const failed = renderUI(<AgentWalletSetupView user={linked} infoFailed onRefresh={() => undefined} />);
  expect(failed).toContain('연결된 지갑 주소를 불러오지 못했어요'); expect(failed).not.toContain('0 tOKRW');
  const loggedOut = renderUI(<AgentWalletSetupView user={null} demo={demo} onRefresh={() => undefined} />);
  expect(loggedOut).toContain('먼저 지갑으로 로그인'); expect(loggedOut).not.toContain(payer);
});
