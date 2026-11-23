import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export function loadOpenAIEnv() {
  const rootEnvFile = fileURLToPath(new URL('../../../.env', import.meta.url));
  if (existsSync(rootEnvFile)) process.loadEnvFile(rootEnvFile);

  if (!process.env.OPENAI_API_KEY?.trim()) {
    throw new Error('OPENAI_API_KEY를 설정해 주세요.');
  }
}
