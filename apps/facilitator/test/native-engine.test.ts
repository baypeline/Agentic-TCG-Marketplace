import Fastify from 'fastify';
import { afterEach, expect, it, vi } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { keccak256, parseTransaction, toHex, type Hex } from 'viem';
import { inspectNativePayment, marooProfile, signNativePayment } from '@tcg/payment-client/native';
import { createNativeEngine } from '../src/native-engine.js';
import { parseEnv } from '../src/config.js';
import { buildApp } from '../src/app.js';
import { createJournal } from '../src/journal.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const closers: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });
const payer = privateKeyToAccount(`0x${'11'.repeat(32)}`);
const payTo = `0x${'2'.repeat(40)}` as Hex;
async function fixture() {
  const requirements = { scheme: marooProfile.scheme, network: marooProfile.network, asset: marooProfile.asset, amount: '5000000000000000000', payTo, maxTimeoutSeconds: 60, extra: { tcgQuoteId: '00000000-0000-4000-8000-000000000001', expiresAt: new Date(Date.now() + 60_000).toISOString() } };
  const payload = await signNativePayment(requirements, payer, { nonce: 0, gas: 30000n, gasPrice: 1_000_000_000n });
  const raw = payload.payload.signedTransaction as Hex, hash = keccak256(raw);
  const transaction = parseTransaction(raw);
  let submitted = false;
  const state = { nonce: 0, balance: 100n * 10n ** 18n, gas: 30000n, code: '0x' };
  const broadcast = vi.fn();
  const rpc = Fastify();
  rpc.post('/', async request => {
    const body = request.body as { id: number; method: string; params: unknown[] };
    const receipt = { transactionHash: hash, transactionIndex: '0x0', blockHash: `0x${'a'.repeat(64)}`, blockNumber: '0x1', from: payer.address, to: payTo, cumulativeGasUsed: '0x7530', gasUsed: '0x7530', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', effectiveGasPrice: '0x3b9aca00', type: '0x0' };
    let result: unknown;
    switch (body.method) {
      case 'eth_chainId': result = toHex(450815); break;
      case 'eth_getTransactionCount': result = toHex(submitted ? 1 : state.nonce); break;
      case 'eth_getBalance': result = toHex(state.balance); break;
      case 'eth_estimateGas': result = toHex(state.gas); break;
      case 'eth_getCode': result = state.code; break;
      case 'eth_sendRawTransaction': expect(body.params[0]).toBe(raw); expect(broadcast).toHaveBeenCalledWith(hash); submitted = true; result = hash; break;
      case 'eth_blockNumber': result = '0x1'; break;
      case 'eth_getTransactionReceipt': result = submitted ? receipt : null; break;
      case 'eth_getTransactionByHash': result = { hash, from: payer.address, to: payTo, value: toHex(5n * 10n ** 18n), input: transaction.data, nonce: '0x0', gas: '0x7530', gasPrice: '0x3b9aca00', blockHash: receipt.blockHash, blockNumber: '0x1', transactionIndex: '0x0', type: '0x0', chainId: toHex(450815), r: transaction.r, s: transaction.s, v: toHex(transaction.v!) }; break;
      default: throw new Error(`Unexpected local RPC ${body.method}`);
    }
    return { jsonrpc: '2.0', id: body.id, result };
  });
  const url = await rpc.listen({ host: '127.0.0.1', port: 0 });
  closers.push(async () => { await rpc.close(); });
  const env = parseEnv({ FACILITATOR_CHAIN: 'maroo', FACILITATOR_RPC_URL: url, FACILITATOR_API_TOKEN: 't'.repeat(32), FACILITATOR_PRIVATE_KEY: `0x${'3'.repeat(64)}`, FACILITATOR_RECIPIENT: payTo, FACILITATOR_PAYERS: payer.address });
  const engine = await createNativeEngine(env);
  return { engine, env, requirements, payload, broadcast, hash, state };
}
it('가짜 마루 RPC에서 서명을 검증하고 같은 원문만 중계하며 재조회는 지급하지 않는다', async () => {
  const f = await fixture();
  expect(await f.engine.verify(f.payload, f.requirements)).toMatchObject({ isValid: true, payer: payer.address });
  expect(f.broadcast).not.toHaveBeenCalled();
  expect(await f.engine.settle(f.payload, f.requirements, f.broadcast)).toMatchObject({ success: true, transaction: f.hash, network: 'eip155:450815' });
  expect(await f.engine.reconcile(f.hash, f.payload, f.requirements)).toMatchObject({ success: true });
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});
it('독립 서버의 native 요청·중복 방지와 거래 해시 보존을 확인한다', async () => {
  const f = await fixture();
  const directory = mkdtempSync(join(tmpdir(), 'tcg-maroo-'));
  const journal = createJournal(directory);
  const settle = f.engine.settle.bind(f.engine);
  f.engine.settle = async (payload, requirements, record) => settle(payload, requirements, hash => { record(hash); f.broadcast(hash); });
  const app = buildApp({ env: f.env, engine: f.engine, journal });
  closers.push(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = () => app.inject({ method: 'POST', url: '/settle', headers: { authorization: `Bearer ${f.env.FACILITATOR_API_TOKEN}`, 'content-type': 'application/json' }, payload: JSON.stringify({ x402Version: 2, paymentPayload: f.payload, paymentRequirements: f.requirements }) });
  const results = await Promise.all([request(), request()]);
  expect(results.map(result => result.json().success)).toEqual([true, true]);
  expect(f.broadcast).toHaveBeenCalledTimes(1);
});
it('주문 내용을 변조하거나 과거 지급을 다른 주문으로 감싸면 서명 검증에서 거부한다', async () => {
  const f = await fixture();
  const changed = { ...f.requirements, amount: '6000000000000000000' };
  expect((await f.engine.verify(f.payload, changed)).isValid).toBe(false);
  await expect(inspectNativePayment(f.payload, { ...f.requirements, extra: { ...f.requirements.extra, tcgQuoteId: '00000000-0000-4000-8000-000000000002' } })).rejects.toThrow();
  expect(f.broadcast).not.toHaveBeenCalled();
});

it('고정 목록 밖의 자동 발급 지갑은 등록 여부에 따라 허용하고 조회 장애에는 정산하지 않는다', async () => {
  const f = await fixture();
  const directory = mkdtempSync(join(tmpdir(), 'tcg-managed-payer-'));
  const settle = f.engine.settle.bind(f.engine);
  f.engine.settle = (payload, requirements, record) => settle(payload, requirements, hash => { record(hash); f.broadcast(hash); });
  const allowed = vi.fn(async () => true);
  const app = buildApp({ env: { ...f.env, FACILITATOR_PAYERS: [`0x${'9'.repeat(40)}`] }, engine: f.engine, journal: createJournal(directory), isPayerAllowed: allowed });
  closers.push(async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); });
  const request = (url: string) => app.inject({ method: 'POST', url, headers: { authorization: `Bearer ${f.env.FACILITATOR_API_TOKEN}` }, payload: { paymentPayload: f.payload, paymentRequirements: f.requirements } });
  expect((await request('/verify')).json().isValid).toBe(true);
  expect(allowed).toHaveBeenCalledWith(payer.address);
  allowed.mockResolvedValueOnce(false);
  expect((await request('/settle')).statusCode).toBe(400);
  allowed.mockRejectedValueOnce(new Error('registry unavailable'));
  expect((await request('/settle')).statusCode).toBe(503);
  expect(f.broadcast).not.toHaveBeenCalled();
  expect((await request('/settle')).json().success).toBe(true);
});
it('가스비 잔액 부족·nonce 변경·가스 부족·컨트랙트 수납처는 방송 전에 거부한다', async () => {
  const f = await fixture();
  const initial = { ...f.state };
  for (const change of [{ balance: 5n * 10n ** 18n }, { nonce: 1 }, { gas: 40000n }, { code: '0x6000' }]) {
    Object.assign(f.state, initial, change);
    expect((await f.engine.verify(f.payload, f.requirements)).isValid).toBe(false);
    expect(await f.engine.settle(f.payload, f.requirements, f.broadcast)).toMatchObject({ success: false, transaction: '' });
  }
  expect(f.broadcast).not.toHaveBeenCalled();
});
