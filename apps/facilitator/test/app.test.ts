import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { asset, network, parseEnv } from '../src/config.js';
import { createJournal } from '../src/journal.js';
import type { Engine } from '../src/engine.js';

const payer = `0x${'1'.repeat(40)}`, payTo = `0x${'2'.repeat(40)}`, transaction = `0x${'a'.repeat(64)}`;
const env = parseEnv({ FACILITATOR_API_TOKEN: 't'.repeat(32), FACILITATOR_PRIVATE_KEY: `0x${'3'.repeat(64)}`, FACILITATOR_RECIPIENT: payTo, FACILITATOR_PAYERS: payer });
const requirements = { scheme: 'exact', network, asset, payTo, amount: '10000', maxTimeoutSeconds: 60, extra: { name: 'USDC', version: '2' } };
const payload = { x402Version: 2, resource: { url: 'mcp://tool/execute_purchase/test' }, accepted: requirements, payload: { signature: `0x${'4'.repeat(130)}`, authorization: { from: payer, to: payTo, value: '10000', validAfter: '0', validBefore: '9999999999', nonce: `0x${'b'.repeat(64)}` } } };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => { for (const clean of cleanups.splice(0).reverse()) await clean(); });
function fixture(directory = mkdtempSync(join(tmpdir(), 'tcg-facilitator-')), settle?: Engine['settle']) {
  const settlement: Engine['settle'] = settle ?? (async (_p, _r, broadcast) => { broadcast(transaction); return { success: true, network, transaction, payer }; });
  const engine: Engine = { address: `0x${'3'.repeat(40)}`, supported: () => ({ kinds: [{ x402Version: 2, scheme: 'exact', network }], extensions: [], signers: {} }), verify: vi.fn(async () => ({ isValid: true, payer })), settle: vi.fn(settlement), reconcile: vi.fn<Engine['reconcile']>(async hash => ({ success: true, network, transaction: hash, payer })) };
  const app = buildApp({ env, engine, journal: createJournal(directory) });
  cleanups.push(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = (url: string, body: unknown = { paymentPayload: payload, paymentRequirements: requirements }, authorized = true) => app.inject({ method: 'POST', url, payload: JSON.stringify(body), headers: { ...(authorized ? { authorization: `Bearer ${env.FACILITATOR_API_TOKEN}` } : {}), 'content-type': 'application/json' } });
  return { app, engine, request, directory };
}

it('헬스·지원 목록을 제공하고 무인증 지급 요청을 차단한다', async () => {
  const f = fixture();
  expect((await f.app.inject('/health')).statusCode).toBe(200);
  expect((await f.app.inject('/supported')).json().kinds[0].network).toBe(network);
  expect((await f.request('/settle', undefined, false)).statusCode).toBe(401);
  expect(f.engine.settle).not.toHaveBeenCalled();
});

it('검증은 지급하지 않으며 동시·반복 settle은 한 번만 정산한다', async () => {
  const f = fixture();
  expect((await f.request('/verify')).json().isValid).toBe(true);
  expect(f.engine.settle).not.toHaveBeenCalled();
  const responses = await Promise.all([f.request('/settle'), f.request('/settle')]);
  expect(responses.map(r => r.json().transaction)).toEqual([transaction, transaction]);
  expect(f.engine.settle).toHaveBeenCalledTimes(1);
});

it('지갑·금액·네트워크·토큰·수납처 변조를 SDK 호출 전에 거부한다', async () => {
  const f = fixture();
  for (const change of [{ network: 'eip155:1' }, { asset: payer }, { payTo: payer }, { amount: '25001' }, { extra: { name: 'Other', version: '2' } }]) {
    expect((await f.request('/settle', { paymentPayload: payload, paymentRequirements: { ...requirements, ...change } })).statusCode).toBe(400);
  }
  const foreign = structuredClone(payload); foreign.payload.authorization.from = payTo;
  expect((await f.request('/settle', { paymentPayload: foreign, paymentRequirements: requirements })).statusCode).toBe(400);
  expect(f.engine.settle).not.toHaveBeenCalled();
});

it('같은 nonce의 다른 지급 내용은 거부하며 유효하지 않은 서명은 제출하지 않는다', async () => {
  const f = fixture();
  vi.mocked(f.engine.verify).mockResolvedValueOnce({ isValid: false, invalidReason: 'invalid_signature' });
  expect((await f.request('/settle')).json().success).toBe(false);
  expect(f.engine.settle).not.toHaveBeenCalled();
  await f.request('/settle');
  const changed = structuredClone(payload); changed.payload.authorization.validBefore = '9999999998';
  expect((await f.request('/settle', { paymentPayload: changed, paymentRequirements: requirements })).statusCode).toBe(409);
  expect(f.engine.settle).toHaveBeenCalledTimes(1);
});

it('브로드캐스트 후 종료해도 SQLite에서 해시를 복원해 증빙만 조회한다', async () => {
  const f = fixture(undefined, async (_p, _r, broadcast) => { broadcast(transaction); throw new Error('RPC timeout'); });
  expect((await f.request('/settle')).json()).toMatchObject({ success: false, transaction, errorReason: 'settlement_pending' });
  await f.app.close();
  const next = fixture(f.directory);
  expect((await next.request('/settle')).json()).toMatchObject({ success: true, transaction });
  expect(next.engine.settle).not.toHaveBeenCalled();
  expect(next.engine.reconcile).toHaveBeenCalledTimes(1);
});

it('해시를 얻지 못한 미확정 지급은 재시도해도 재전송하지 않는다', async () => {
  const f = fixture(undefined, async () => { throw new Error('unknown sensitive RPC error'); });
  await f.request('/settle');
  const second = await f.request('/settle');
  expect(second.json().errorReason).toBe('settlement_pending');
  expect(second.body).not.toContain('sensitive');
  expect(f.engine.settle).toHaveBeenCalledTimes(1);
});

it('컨테이너 재시작 후에도 완료 영수증을 반환한다', async () => {
  const f = fixture(); await f.request('/settle'); await f.app.close();
  const next = fixture(f.directory);
  expect((await next.request('/settle')).json().transaction).toBe(transaction);
  expect(next.engine.settle).not.toHaveBeenCalled();
});

it('완료한 지급의 nonce를 다른 주문에 재사용할 수 없다', async () => {
  const f = fixture();
  const first = { ...requirements, extra: { ...requirements.extra, tcgQuoteId: '00000000-0000-4000-8000-000000000001' } };
  const original = { ...payload, accepted: first };
  expect((await f.request('/settle', { paymentPayload: original, paymentRequirements: first })).json().success).toBe(true);
  const other = { ...first, extra: { ...first.extra, tcgQuoteId: '00000000-0000-4000-8000-000000000002' } };
  expect((await f.request('/settle', { paymentPayload: original, paymentRequirements: other })).statusCode).toBe(400);
  expect((await f.request('/settle', { paymentPayload: { ...original, accepted: other }, paymentRequirements: other })).statusCode).toBe(409);
  expect(f.engine.settle).toHaveBeenCalledTimes(1);
});
