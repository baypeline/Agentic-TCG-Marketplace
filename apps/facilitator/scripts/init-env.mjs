import { getPaymentProfile } from '@tcg/contracts/payment-profile';
import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { parse } from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

try {
  const rootPath = new URL('../../../.env', import.meta.url);
  const secretPath = new URL('../../../infra/.env.facilitator', import.meta.url);
  let root = await readFile(rootPath, 'utf8');
  const settings = parse(root);
  const oldText = await readFile(secretPath, 'utf8').catch(error => { if (error.code === 'ENOENT') return ''; throw error; });
  const old = parse(oldText);
  const profile = getPaymentProfile(settings.PAYMENT_CHAIN === 'maroo' ? 'maroo' : 'base-sepolia');
  const payers = [...new Set([settings.AGENT_SERVER_WALLET_ADDRESS, settings.AGENT_WALLET_ADDRESS].filter(Boolean))];
  if (!payers.length || !/^0x[\da-fA-F]{40}$/.test(settings.PAYMENT_RECIPIENT ?? '')) throw new Error();
  const key = old.FACILITATOR_PRIVATE_KEY || generatePrivateKey();
  const account = privateKeyToAccount(key);
  if ([...payers, settings.PAYMENT_RECIPIENT].some(address => address.toLowerCase() === account.address.toLowerCase())) throw new Error();
  const token = old.FACILITATOR_API_TOKEN || randomBytes(32).toString('hex');
  let port = old.FACILITATOR_PORT;
  if (!port) {
    const socket = createServer();
    await new Promise((resolve, reject) => { socket.once('error', reject); socket.listen(0, '127.0.0.1', resolve); });
    port = String(socket.address().port);
    await new Promise(resolve => socket.close(resolve));
  }
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535 || token.length < 32) throw new Error();
  const values = { FACILITATOR_CHAIN: profile.chain, FACILITATOR_PORT: port, FACILITATOR_RPC_URL: old.FACILITATOR_CHAIN === profile.chain ? old.FACILITATOR_RPC_URL || profile.rpcUrl : profile.rpcUrl, FACILITATOR_API_TOKEN: token, FACILITATOR_PRIVATE_KEY: key, FACILITATOR_RECIPIENT: settings.PAYMENT_RECIPIENT, FACILITATOR_PAYERS: payers.join(','), FACILITATOR_MAX_AMOUNT: old.FACILITATOR_CHAIN === profile.chain ? old.FACILITATOR_MAX_AMOUNT || profile.maxPerTrade : profile.maxPerTrade };
  await writeFile(secretPath, Object.entries(values).map(([name, value]) => `${name}=${value}`).join('\n') + '\n', { mode: 0o600 });
  for (const [name, value] of Object.entries({ PAYMENT_FACILITATOR_URL: `http://127.0.0.1:${port}`, PAYMENT_FACILITATOR_TOKEN: token })) {
    if ([...root.matchAll(new RegExp(`^${name}=`, 'gm'))].length > 1) throw new Error();
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    root = pattern.test(root) ? root.replace(pattern, () => `${name}=${value}`) : `${root.trimEnd()}\n${name}=${value}\n`;
  }
  await writeFile(rootPath, root, { mode: 0o600 });
  console.log(JSON.stringify({ signer: account.address, facilitatorUrl: `http://127.0.0.1:${port}`, network: profile.network, secretFile: 'infra/.env.facilitator' }));
  console.log(profile.chain === 'maroo' ? '마루에서는 구매 지갑이 결제와 가스비를 tOKRW로 부담합니다. API를 재시작하세요.' : '가스비용 Base Sepolia ETH를 전용 signer 주소에 충전하세요. API를 재시작하세요.');
} catch {
  console.error('퍼실리테이터 설정 실패. 루트 .env의 공개 지갑 주소와 기존 별도 설정 파일을 확인하세요. 비밀값은 출력하지 않습니다.');
  process.exitCode = 1;
}
