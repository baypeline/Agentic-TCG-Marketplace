import { expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config.js';
import { createPayerRegistry } from '../src/payers.js';
const legacy = `0x${'1'.repeat(40)}`, managed = `0x${'2'.repeat(40)}`;
const env = parseEnv({ FACILITATOR_API_TOKEN: 't'.repeat(32), FACILITATOR_PRIVATE_KEY: `0x${'3'.repeat(64)}`, FACILITATOR_RECIPIENT: `0x${'4'.repeat(40)}`, FACILITATOR_PAYERS: legacy, FACILITATOR_PAYER_REGISTRY_URL: 'http://localhost:4000/internal/facilitator/payers/check' });
it('기존 지갑은 보존하고 새 지갑은 매번 등록 여부를 확인하여 해제를 즉시 반영한다', async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json({ address: managed, allowed: true })).mockResolvedValueOnce(Response.json({ address: managed, allowed: false }));
  const allowed = createPayerRegistry(env, request);
  expect(await allowed(legacy)).toBe(true); expect(request).not.toHaveBeenCalled();
  expect(await allowed(managed)).toBe(true); expect(await allowed(managed)).toBe(false);
  expect(request).toHaveBeenCalledWith(env.FACILITATOR_PAYER_REGISTRY_URL, expect.objectContaining({ method: 'POST', headers: expect.objectContaining({ authorization: `Bearer ${env.FACILITATOR_API_TOKEN}` }), body: JSON.stringify({ address: managed }), redirect: 'error' }));
  expect(await createPayerRegistry({ ...env, FACILITATOR_PAYER_REGISTRY_URL: undefined }, request)(managed)).toBe(false);
});
it('API 장애나 인증 실패 및 잘못된 응답을 허용으로 처리하지 않는다', async () => {
  for (const response of [Response.json({}, { status: 401 }), Response.json({ address: legacy, allowed: true }), Response.json({ address: managed, allowed: 'true' })]) {
    await expect(createPayerRegistry(env, vi.fn<typeof fetch>().mockResolvedValue(response))(managed)).rejects.toThrow();
  }
  await expect(createPayerRegistry(env, vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout')))(managed)).rejects.toThrow();
});
