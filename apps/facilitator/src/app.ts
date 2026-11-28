import { createHash, timingSafeEqual } from 'node:crypto';
import Fastify from 'fastify';
import { z } from 'zod';
import { PaymentPayloadV2Schema, PaymentRequirementsV2Schema } from '@x402/core/schemas';
import type { PaymentPayload, PaymentRequirements, SettleResponse } from '@x402/core/types';
import { asset, network, type FacilitatorEnv } from './config.js';
import type { Engine } from './engine.js';
import type { Journal } from './journal.js';

const bodySchema = z.object({ x402Version: z.literal(2).optional(), paymentPayload: PaymentPayloadV2Schema, paymentRequirements: PaymentRequirementsV2Schema });
const authorizationSchema = z.object({ from: z.string().regex(/^0x[\da-fA-F]{40}$/), to: z.string().regex(/^0x[\da-fA-F]{40}$/), value: z.string().regex(/^[1-9]\d*$/), validAfter: z.string().regex(/^\d+$/), validBefore: z.string().regex(/^\d+$/), nonce: z.string().regex(/^0x[\da-fA-F]{64}$/) }).strict();
const signedSchema = z.object({ authorization: authorizationSchema, signature: z.string().regex(/^0x[\da-fA-F]{130}$/) }).strict();
const hash = (text: string) => createHash('sha256').update(text).digest('hex');

export function buildApp({ env, engine, journal }: { env: FacilitatorEnv; engine: Engine; journal: Journal }) {
  const app = Fastify({ bodyLimit: 16_384, logger: false });
  const credential = Buffer.from(`Bearer ${env.FACILITATOR_API_TOKEN}`);
  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url === '/supported') return;
    const received = Buffer.from(request.headers.authorization ?? '');
    if (received.length !== credential.length || !timingSafeEqual(received, credential)) return reply.code(401).send({ error: 'unauthorized' });
  });
  app.setErrorHandler((error, _request, reply) => reply.code(error instanceof Error && 'statusCode' in error && error.statusCode === 413 ? 413 : 503).send({ error: 'facilitator_unavailable' }));
  app.addHook('onClose', async () => { await queue; journal.close(); });
  app.get('/health', async () => ({ status: 'ok', network, signer: engine.address }));
  app.get('/supported', async () => engine.supported());
  let queue: Promise<unknown> = Promise.resolve();

  function validate(body: unknown) {
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) return null;
    const { paymentPayload: payload } = parsed.data;
    const requirements = parsed.data.paymentRequirements as PaymentRequirements;
    const signed = signedSchema.safeParse(payload.payload);
    if (!signed.success) return null;
    const auth = signed.data.authorization;
    const accepted = payload.accepted as PaymentRequirements;
    const matches = (r: PaymentRequirements) => r.scheme === 'exact' && r.network === network && r.asset.toLowerCase() === asset.toLowerCase() && r.payTo.toLowerCase() === env.FACILITATOR_RECIPIENT.toLowerCase() && r.amount === auth.value && BigInt(r.amount) <= BigInt(env.FACILITATOR_MAX_AMOUNT) && r.extra?.name === 'USDC' && r.extra?.version === '2' && (!r.extra.assetTransferMethod || r.extra.assetTransferMethod === 'eip3009');
    if (!matches(requirements) || !matches(accepted) || requirements.extra?.tcgQuoteId !== accepted.extra?.tcgQuoteId || (requirements.extra?.tcgQuoteId !== undefined && !z.uuid().safeParse(requirements.extra.tcgQuoteId).success) || auth.to.toLowerCase() !== requirements.payTo.toLowerCase() || !env.FACILITATOR_PAYERS.includes(auth.from.toLowerCase())) return null;
    const id = hash([network, asset.toLowerCase(), auth.from.toLowerCase(), auth.nonce.toLowerCase()].join(':'));
    const fingerprint = hash(JSON.stringify([auth.from.toLowerCase(), auth.to.toLowerCase(), auth.value, auth.validAfter, auth.validBefore, auth.nonce.toLowerCase(), network, asset.toLowerCase(), requirements.extra?.tcgQuoteId ?? null, payload.resource?.url ?? null, hash(signed.data.signature.toLowerCase())]));
    return { payload: payload as PaymentPayload, requirements, id, fingerprint, payer: auth.from };
  }
  app.post('/verify', async (request, reply) => {
    const input = validate(request.body);
    if (!input) return reply.code(400).send({ isValid: false, invalidReason: 'payment_not_allowed' });
    try { return await engine.verify(input.payload, input.requirements); }
    catch { return reply.code(503).send({ isValid: false, invalidReason: 'verification_unavailable' }); }
  });
  app.post('/settle', async (request, reply) => {
    const input = validate(request.body);
    if (!input) return reply.code(400).send({ success: false, errorReason: 'payment_not_allowed', network, transaction: '' });
    const { payload, requirements, id, fingerprint, payer } = input;
    const pending = (transaction = ''): SettleResponse => ({ success: false, errorReason: 'settlement_pending', network, transaction, payer });
    const work = async () => {
      const previous = journal.get(id);
      if (previous) {
        if (previous.fingerprint !== fingerprint) return reply.code(409).send({ success: false, errorReason: 'nonce_conflict', network, transaction: '' });
        if (previous.result) return JSON.parse(previous.result) as SettleResponse;
        if (previous.transaction_hash) {
          try {
            const result = await engine.reconcile(previous.transaction_hash, payload, requirements);
            journal.finish(id, result);
            return result;
          } catch { return pending(previous.transaction_hash); }
        }
        // 브로드캐스트 직후 프로세스가 종료되어 해시를 못 쓴 경우에도 재전송하지 않는다.
        return pending();
      }
      const verified = await engine.verify(payload, requirements);
      if (!verified.isValid) return { success: false, errorReason: verified.invalidReason ?? 'invalid_payment', transaction: '', network, payer };
      if (!journal.claim(id, fingerprint)) return pending();
      try {
        const result = await engine.settle(payload, requirements, transaction => journal.broadcast(id, transaction));
        if (result.success && /^0x[\da-fA-F]{64}$/.test(result.transaction)) { journal.finish(id, result); return result; }
        return pending(journal.get(id)?.transaction_hash ?? result.transaction ?? '');
      } catch { return pending(journal.get(id)?.transaction_hash ?? ''); }
    };
    // 단일 가스 지갑의 nonce 경합을 피하고 동일 요청의 동시 제출을 직렬화한다.
    const task = queue.then(work);
    queue = task.catch(() => undefined);
    return task;
  });
  return app;
}
