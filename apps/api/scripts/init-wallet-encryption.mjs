import { readFile, appendFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
const path = new URL('../../../.env', import.meta.url);
const source = await readFile(path, 'utf8');
if (/^AGENT_WALLET_ENCRYPTION_KEY=/m.test(source)) {
  console.log('에이전트 지갑 암호화 키가 이미 설정되어 있습니다. 기존 값을 유지합니다.');
} else {
  await appendFile(path, `\n# 사용자별 에이전트 지갑 암호화 키. DB와 함께 백업하고 변경하지 마세요.\nAGENT_WALLET_ENCRYPTION_KEY=${randomBytes(32).toString('hex')}\n`, { encoding: 'utf8', mode: 0o600 });
  console.log('에이전트 지갑 암호화 키를 .env에 추가했습니다. 비밀값은 출력하지 않습니다.');
}
