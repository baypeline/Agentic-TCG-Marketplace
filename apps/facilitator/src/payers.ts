import { z } from 'zod';
import type { FacilitatorEnv } from './config.js';

export function createPayerRegistry(env: FacilitatorEnv, request: typeof fetch = fetch) {
  return async (payer: string): Promise<boolean> => {
    if (env.FACILITATOR_PAYERS.includes(payer.toLowerCase())) return true;
    if (!env.FACILITATOR_PAYER_REGISTRY_URL) return false;
    const response = await request(env.FACILITATOR_PAYER_REGISTRY_URL, {
      method: 'POST', headers: { authorization: `Bearer ${env.FACILITATOR_API_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ address: payer.toLowerCase() }), cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error('payer_registry_unavailable');
    const result = z.object({ address: z.string().regex(/^0x[\da-fA-F]{40}$/), allowed: z.boolean() }).parse(await response.json());
    if (result.address.toLowerCase() !== payer.toLowerCase()) throw new Error('payer_registry_mismatch');
    return result.allowed;
  };
}
