// 응답 유실 시 새 의도를 만들지 않는다. 페이지 재접속도 같은 저장 요청을 재사용한다.
export type PendingTradingRequest = { method: string; path: string; input?: unknown; key: string };
export function createTradingClient(storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>, scope: string) {
  const slot = `tcg.pending.${scope}`;
  const pending = (): PendingTradingRequest | null => { const raw = storage.getItem(slot); return raw ? JSON.parse(raw) as PendingTradingRequest : null; };
  async function send(work: PendingTradingRequest) {
    const response = await fetch(`/api/trading/${work.path}`, { method: work.method, headers: { 'content-type': 'application/json', 'idempotency-key': work.key }, body: work.input === undefined ? undefined : JSON.stringify(work.input) });
    const data = await response.json();
    if (response.status < 500) storage.removeItem(slot);
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message ?? '요청을 처리하지 못했습니다.');
    return data as unknown;
  }
  return {
    pending,
    async mutate(method: string, path: string, input?: unknown) {
      const current = pending();
      if (current) throw new Error('이전 요청의 응답을 확인해야 합니다. 같은 요청 다시 확인을 눌러주세요.');
      const work = { method, path, input, key: crypto.randomUUID() };
      storage.setItem(slot, JSON.stringify(work));
      return send(work);
    },
    async retry() { const work = pending(); if (!work) throw new Error('확인할 요청이 없습니다.'); return send(work); },
  };
}
