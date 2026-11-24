import { createHash } from 'node:crypto';
import { AppError, mutationContextSchema, type MutationContext } from '@tcg/contracts';
import type { TradingStore, TradingTransaction } from './store.js';

export function createRequestExecutor(store: TradingStore, now = () => new Date()) {
  return async <T>(auth: { userId: string; agentId?: string }, operation: string, input: unknown, context: MutationContext, work: (tx: TradingTransaction, time: Date) => Promise<T>): Promise<T> => {
    const { idempotencyKey: requestKey } = mutationContextSchema.parse(context);
    const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const id = hash([auth.userId, auth.agentId ?? null, operation, requestKey]);
    const inputHash = hash(input);
    return store.transaction(async tx => {
      const existing = await tx.requests.get(id);
      if (existing) {
        if (existing.inputHash !== inputHash) throw new AppError('IDEMPOTENCY_CONFLICT', '같은 요청 키를 다른 입력에 사용할 수 없습니다.', 409);
        return JSON.parse(existing.resultJson) as T;
      }
      const result = await work(tx, now());
      await tx.requests.insert({ id, userId: auth.userId, agentId: auth.agentId ?? null, operation, requestKey, inputHash, resultJson: JSON.stringify(result) });
      return result;
    });
  };
}
