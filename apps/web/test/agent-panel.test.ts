import { expect, it } from 'vitest';
import { createAgentPanelStore } from '../src/stores/agent-panel';

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return { getItem: () => value, setItem: (_key: string, next: string) => { value = next; }, removeItem: () => { value = null; } };
}

it('처음에는 닫혀 있고 저장한 열림·닫힘 상태만 새 인스턴스에 복원한다', async () => {
  const storage = memoryStorage();
  const first = createAgentPanelStore(storage);
  expect(first.getInitialState().chatOpen).toBe(false);
  await first.persist.rehydrate();
  first.getState().setChatOpen(true);
  expect(JSON.parse(storage.getItem()!)).toEqual({ state: { chatOpen: true }, version: 1 });
  const second = createAgentPanelStore(storage);
  expect(second.getState().chatOpen).toBe(false);
  await second.persist.rehydrate();
  expect(second.getState().chatOpen).toBe(true);
  second.getState().setChatOpen(false);
  const third = createAgentPanelStore(storage);
  await third.persist.rehydrate();
  expect(third.getState().chatOpen).toBe(false);
});

it('잘못된 저장 상태는 패널을 열거나 액션을 덮어쓰지 않는다', async () => {
  const store = createAgentPanelStore(memoryStorage(JSON.stringify({ state: { chatOpen: 'true', setChatOpen: 'invalid' }, version: 1 })));
  await store.persist.rehydrate();
  expect(store.getState().chatOpen).toBe(false);
  store.getState().setChatOpen(true);
  expect(store.getState().chatOpen).toBe(true);
});
