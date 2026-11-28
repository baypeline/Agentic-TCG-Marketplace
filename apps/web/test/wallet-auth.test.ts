import { afterEach, expect, it, vi } from 'vitest';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { toHex, verifyMessage, type EIP1193Provider } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { loginWallet } from '../src/features/auth/wallet-client';
import { NextRequest } from 'next/server';
import { POST, GET } from '../src/app/api/auth/[action]/route';

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it('브라우저 지갑은 로그인 메시지만 서명하고 개인키나 송금 요청을 전달하지 않는다', async () => {
  const account = privateKeyToAccount(generatePrivateKey());
  const message = createSiweMessage({ address: account.address, domain: '127.0.0.1:3000', uri: 'http://127.0.0.1:3000', version: '1', chainId: 450815, nonce: 'abcdef12345678' });
  const user = { address: account.address, userId: '00000000-0000-4000-8000-000000000001', agentId: '00000000-0000-4000-8000-000000000002', agentWalletLinked: false, expiresAt: '2099-01-01T00:00:00.000Z' };
  const methods: string[] = [];
  const provider = { request: async ({ method, params }: { method: string; params?: unknown[] }) => {
    methods.push(method);
    if (['eth_requestAccounts','eth_accounts'].includes(method)) return [account.address];
    if (method === 'eth_chainId') return toHex(450815);
    if (method === 'personal_sign') return account.signMessage({ message: { raw: params![0] as `0x${string}` } });
    throw new Error(`Unexpected ${method}`);
  } } as EIP1193Provider;
  vi.stubGlobal('fetch', vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(init.body as string);
    if (url.endsWith('challenge')) { expect(body).toEqual({ address: account.address }); return Response.json({ id: user.userId, message, chainId: 450815, expiresAt: user.expiresAt }); }
    expect(Object.keys(body)).toEqual(['signature']); expect(await verifyMessage({ address: account.address, message, signature: body.signature })).toBe(true);
    return Response.json({ user });
  }));
  expect(await loginWallet(provider)).toEqual({ user });
  expect(methods).not.toContain('eth_sendTransaction'); expect(methods).not.toContain('eth_signTypedData_v4');
});

it('웹 인증 중계는 브라우저 바인딩과 HttpOnly 쿠키를 사용하고 토큰을 JSON에서 제거한다', async () => {
  vi.stubEnv('CORE_API_URL', 'http://127.0.0.1:4000');
  const id = '00000000-0000-4000-8000-000000000001', binding = 'b'.repeat(64), token = `wallet_${'a'.repeat(64)}`;
  const user = { userId: id, agentId: '00000000-0000-4000-8000-000000000002', address: `0x${'1'.repeat(40)}`, agentWalletLinked: false, expiresAt: '2099-01-01T00:00:00.000Z' };
  const request = (action: string, body: object = {}, origin = 'http://127.0.0.1:3000', cookie = `tcg_auth_challenge=${id}.${binding}; tcg_session=${token}`) => new NextRequest(`http://127.0.0.1:3000/api/auth/${action}`, { method: 'POST', headers: { host: '127.0.0.1:3000', origin, cookie, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const context = (action: string) => ({ params: Promise.resolve({ action }) });
  const upstream = vi.fn(async (url: URL, init: RequestInit) => {
    if (url.pathname.endsWith('challenge')) { expect(init.headers).not.toHaveProperty('authorization'); return Response.json({ id, message: 'login', chainId: 450815, expiresAt: user.expiresAt }); }
    expect(JSON.parse(init.body as string)).toEqual({ signature: `0x${'1'.repeat(130)}`, challengeId: id, binding });
    return Response.json({ user, token });
  }); vi.stubGlobal('fetch', upstream);
  expect((await POST(request('verify', {}, 'https://evil.test'), context('verify'))).status).toBe(403);
  expect(upstream).not.toHaveBeenCalled();
  const challenge = await POST(request('challenge', { address: user.address }), context('challenge'));
  expect(challenge.cookies.get('tcg_auth_challenge')?.httpOnly).toBe(true);
  const result = await POST(request('verify', { signature: `0x${'1'.repeat(130)}` }), context('verify'));
  expect(await result.json()).toEqual({ user });
  expect(result.cookies.get('tcg_session')).toMatchObject({ value: token, httpOnly: true, sameSite: 'strict', path: '/' });
  expect(await (await GET(new NextRequest('http://127.0.0.1:3000/api/auth/session'), context('session'))).json()).toEqual({ user: null });
});
