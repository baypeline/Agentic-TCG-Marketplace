import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

export function isLoopbackHost(host: string) {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(host);
}

export function getLocalAgentSecret(nodeEnv: string | undefined, secret: string | undefined) {
  const value = secret?.trim();
  return nodeEnv === 'development' && value && value.length >= 32 ? value : undefined;
}

function signature(userId: string, secret: string) {
  return createHmac('sha256', secret).update(`local-agent:${userId}`).digest('base64url');
}

export function createLocalAgentToken(secret: string) {
  const userId = randomUUID();
  return `${userId}.${signature(userId, secret)}`;
}

export function readLocalAgentUserId(token: string | undefined, secret: string) {
  // 형식을 제한한 뒤 브라우저 식별자에 붙은 서명을 검증한다.
  const match = /^([a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})\.([A-Za-z0-9_-]{43})$/.exec(token ?? '');
  if (!match) return undefined;
  const [, userId, signed] = match;
  const expected = signature(userId!, secret);
  return timingSafeEqual(Buffer.from(signed!), Buffer.from(expected)) ? userId : undefined;
}
