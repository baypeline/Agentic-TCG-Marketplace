import { readFile, writeFile } from 'node:fs/promises';
import { parse } from 'dotenv';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// 재실행해도 기존 키를 회전하거나 브라우저 구매 지갑 설정을 바꾸지 않는다.
try {
  const path = new URL('../../../.env', import.meta.url);
  let content = await readFile(path, 'utf8');
  const env = parse(content);
  if (env.PAYMENT_ENABLED !== 'true' || env.DEMO_SCENARIOS_ENABLED !== 'true') throw new Error();
  for (const name of ['AGENT_SERVER_PRIVATE_KEY', 'AGENT_SERVER_WALLET_ADDRESS', 'AGENT_SIGNING_MODE']) {
    if ([...content.matchAll(new RegExp(`^${name}=`, 'gm'))].length > 1) throw new Error();
  }
  const key = env.AGENT_SERVER_PRIVATE_KEY || generatePrivateKey();
  const account = privateKeyToAccount(key);
  if (env.AGENT_SERVER_WALLET_ADDRESS && env.AGENT_SERVER_WALLET_ADDRESS.toLowerCase() !== account.address.toLowerCase()) throw new Error();
  if (account.address.toLowerCase() === env.PAYMENT_RECIPIENT?.toLowerCase()) throw new Error();
  function put(name, value) {
    const pattern = new RegExp(`^${name}=.*$`, 'm');
    content = pattern.test(content) ? content.replace(pattern, () => `${name}=${value}`) : `${content.trimEnd()}\n${name}=${value}\n`;
  }
  put('AGENT_SERVER_PRIVATE_KEY', key);
  put('AGENT_SERVER_WALLET_ADDRESS', account.address);
  put('AGENT_SIGNING_MODE', 'server');
  await writeFile(path, content, { mode: 0o600 });
  console.log(`에이전트 전용 지갑: ${account.address}`);
  console.log('개인키는 루트 .env에 저장했습니다. Base Sepolia 테스트 USDC를 충전한 뒤 API를 재시작하세요.');
} catch {
  console.error('지갑을 구성하지 못했습니다. 루트 .env의 시나리오·결제 활성화, 중복 설정, 기존 전용 지갑 설정을 확인하세요. 비밀값은 출력하지 않습니다.');
  process.exitCode = 1;
}
