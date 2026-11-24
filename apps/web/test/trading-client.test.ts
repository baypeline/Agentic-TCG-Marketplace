import { afterEach, expect, it, vi } from 'vitest';
import { createTradingClient } from '../src/lib/trading-client';
afterEach(() => vi.unstubAllGlobals());
function storage() { const entries = new Map<string,string>(); return { getItem:(key:string) => entries.get(key) ?? null, setItem:(key:string,value:string) => { entries.set(key,value); }, removeItem:(key:string) => { entries.delete(key); } }; }
it('저장 응답 유실 후 재접속해도 같은 키·인수로 재확인하고 새 의도를 차단한다', async () => {
  const fetch = vi.fn().mockRejectedValueOnce(new Error('lost response')).mockResolvedValueOnce(Response.json({ id:'policy' },{status:201})); vi.stubGlobal('fetch',fetch);
  const db = storage(), client = createTradingClient(db,'buyer');
  await expect(client.mutate('POST','policies',{ totalBudget:'1000000' })).rejects.toThrow('lost response');
  const resumed = createTradingClient(db,'buyer');
  await expect(resumed.mutate('POST','policies',{ totalBudget:'2000000' })).rejects.toThrow('이전 요청');
  await resumed.retry();
  expect(fetch.mock.calls[0]).toEqual(fetch.mock.calls[1]);
  expect(resumed.pending()).toBeNull();
});
it('확정 업무 오류는 다음 의도를 허용하고 다른 신원에 미확인 작업을 노출하지 않는다', async () => {
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({ error:{message:'예산 부족'} },{status:409})));
  const db = storage(), client = createTradingClient(db,'buyer');
  await expect(client.mutate('PUT','policies/id',{})).rejects.toThrow('예산 부족');
  expect(client.pending()).toBeNull();
  vi.stubGlobal('fetch',vi.fn(async () => Response.json({error:'unknown'},{status:502})));
  await expect(client.mutate('POST','listings',{})).rejects.toThrow('unknown');
  expect(client.pending()).not.toBeNull();
  expect(createTradingClient(db,'seller').pending()).toBeNull();
});
