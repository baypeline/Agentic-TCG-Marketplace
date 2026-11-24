import { randomUUID } from 'node:crypto';
import { AppError, policyInputSchema, policyUpdateSchema, spendingPolicySchema, tradingBuyerSchema, agentRunInputSchema, type TradingBuyer, type MutationContext, type SpendingPolicy } from '@tcg/contracts';
import { createRequestExecutor, type TradingStore, type TradingTransaction, type PolicyRow, type RunRow } from '@tcg/trading';

export function policyDto(row: PolicyRow) { return spendingPolicySchema.parse(JSON.parse(row.policyJson)); }
export function budgetDto(row: PolicyRow) {
  return { policyId: row.id, totalBudget: row.totalBudget, spentAmount: row.spentAmount, reservedAmount: row.reservedAmount, availableAmount: (BigInt(row.totalBudget) - BigInt(row.spentAmount) - BigInt(row.reservedAmount)).toString() };
}
export async function ownedPolicy(tx: TradingTransaction, auth: TradingBuyer, id: string) {
  const row = await tx.policies.get(id);
  if (!row) throw new AppError('POLICY_NOT_FOUND', '정책을 찾을 수 없습니다.', 404);
  if (row.userId !== auth.userId || row.agentId !== auth.agentId) throw new AppError('FORBIDDEN', '정책에 접근할 수 없습니다.', 403);
  return row;
}
export async function getPolicyExecutionContext(tx: TradingTransaction, auth: TradingBuyer, time: Date, policyId?: string | null) {
  const runs = (await tx.runs.find({ userId: auth.userId, agentId: auth.agentId, status: 'RUNNING' })).filter(run => run.expiresAt > time && (!policyId || run.policyId === policyId));
  const id = policyId ?? runs[0]?.policyId;
  if (!id) return null;
  const row = await ownedPolicy(tx, auth, id);
  const policy = policyDto(row);
  return { online: runs.some(run => run.policyId === id) && policy.enabled && new Date(policy.validUntil) > time, policy, availableBudget: budgetDto(row).availableAmount };
}
export function runDto(row: RunRow) {
  return { id: row.id, policyId: row.policyId, instruction: row.instruction, status: row.status as 'RUNNING' | 'STOPPED' | 'COMPLETED' | 'FAILED', expiresAt: row.expiresAt.toISOString(), result: row.result };
}
export function createPolicyService({ store, now = () => new Date(), onInactive }: { store: TradingStore; now?: () => Date; onInactive?: (auth: TradingBuyer) => Promise<unknown> }) {
  const mutate = createRequestExecutor(store, now);
  const buyer = tradingBuyerSchema.parse;
  async function ownRun(tx: TradingTransaction, auth: TradingBuyer, id: string) {
    const run = await tx.runs.get(id);
    if (!run || run.userId !== auth.userId || run.agentId !== auth.agentId) throw new AppError('SESSION_NOT_FOUND', '실행을 찾을 수 없습니다.', 404);
    return run;
  }
  const service = {
    async create(auth: TradingBuyer, raw: unknown, context: MutationContext) {
      auth = buyer(auth); const input = policyInputSchema.parse(raw);
      if (BigInt(input.maxPerTrade) > BigInt(input.totalBudget)) throw new AppError('VALIDATION_ERROR', '건당 한도는 총예산 이하이어야 합니다.');
      return mutate(auth, 'policy.create', input, context, async (tx, time) => {
        const policy: SpendingPolicy = { ...input, id: randomUUID(), agentId: auth.agentId, version: 1 };
        await tx.policies.insert({ id: policy.id, userId: auth.userId, agentId: auth.agentId, version: 1, policyJson: JSON.stringify(policy), totalBudget: policy.totalBudget, spentAmount: '0', reservedAmount: '0' });
        await tx.versions.insert({ id: `${policy.id}:1`, policyId: policy.id, version: 1, policyJson: JSON.stringify(policy), createdAt: time });
        return policy;
      });
    },
    async update(auth: TradingBuyer, id: string, raw: unknown, context: MutationContext) {
      auth = buyer(auth); const input = policyUpdateSchema.parse(raw);
      const result = await mutate(auth, 'policy.update', { id, ...input }, context, async (tx, time) => {
        const row = await ownedPolicy(tx, auth, id);
        if (row.version !== input.expectedVersion) throw new AppError('IDEMPOTENCY_CONFLICT', '정책 버전이 변경됐습니다. 다시 조회하세요.', 409);
        if (BigInt(input.totalBudget) < BigInt(row.spentAmount) + BigInt(row.reservedAmount)) throw new AppError('BUDGET_EXCEEDED', '사용 완료액과 결제 예약액보다 총예산을 낮출 수 없습니다.', 409);
        if (BigInt(input.maxPerTrade) > BigInt(input.totalBudget)) throw new AppError('VALIDATION_ERROR', '건당 한도는 총예산 이하이어야 합니다.');
        const { expectedVersion: _, ...fields } = input;
        const policy = { ...fields, id, agentId: auth.agentId, version: row.version + 1 };
        await tx.policies.replace({ ...row, version: policy.version, totalBudget: policy.totalBudget, policyJson: JSON.stringify(policy) }, { version: row.version });
        await tx.versions.insert({ id: `${id}:${policy.version}`, policyId: id, version: policy.version, policyJson: JSON.stringify(policy), createdAt: time });
        if (!policy.enabled) for (const run of await tx.runs.find({ policyId: id, status: 'RUNNING' })) await tx.runs.replace({ ...run, status: 'STOPPED' }, { status: 'RUNNING' });
        return policy;
      });
      if (!result.enabled && !(await service.listRuns(auth)).some(run => run.status === 'RUNNING' && new Date(run.expiresAt) > now())) await onInactive?.(auth);
      return result;
    },
    async list(auth: TradingBuyer) { auth = buyer(auth); return store.transaction(async tx => (await tx.policies.find({ userId: auth.userId, agentId: auth.agentId })).map(policyDto)); },
    async get(auth: TradingBuyer, id: string) { auth = buyer(auth); return store.transaction(async tx => policyDto(await ownedPolicy(tx, auth, id))); },
    async budget(auth: TradingBuyer, id: string) { auth = buyer(auth); return store.transaction(async tx => budgetDto(await ownedPolicy(tx, auth, id))); },
    async versions(auth: TradingBuyer, id: string) { auth = buyer(auth); return store.transaction(async tx => { await ownedPolicy(tx, auth, id); return (await tx.versions.find({ policyId: id })).sort((a,b) => a.version-b.version).map(row => spendingPolicySchema.parse(JSON.parse(row.policyJson))); }); },
    async startRun(auth: TradingBuyer, raw: unknown, context: MutationContext) {
      auth = buyer(auth); const input = agentRunInputSchema.parse(raw);
      return mutate(auth, 'run.start', input, context, async (tx, time) => {
        const row = await ownedPolicy(tx, auth, input.policyId); const policy = policyDto(row);
        if (!policy.enabled || new Date(policy.validUntil) <= time) throw new AppError('POLICY_VIOLATION', '활성 승인 정책이 필요합니다.', 409);
        if ((await tx.runs.find({ userId: auth.userId, agentId: auth.agentId, status: 'RUNNING' })).some(run => run.expiresAt > time && run.policyId !== input.policyId)) throw new AppError('POLICY_VIOLATION', '동일 Agent의 동시 실행은 같은 정책을 공유해야 합니다.', 409);
        const run: RunRow = { id: randomUUID(), userId: auth.userId, agentId: auth.agentId, ...input, status: 'RUNNING', expiresAt: new Date(Math.min(new Date(policy.validUntil).getTime(), time.getTime() + 24*60*60*1000)), result: null };
        await tx.runs.insert(run); return runDto(run);
      });
    },
    async actionKey(auth: TradingBuyer, runId: string, action: string, input: unknown) {
      auth = buyer(auth);
      return mutate(auth, 'run.actionKey', { runId, action, input }, { idempotencyKey: `${runId}:${action}` }, async tx => { await ownRun(tx, auth, runId); return randomUUID(); });
    },
    async getRun(auth: TradingBuyer, id: string) { auth = buyer(auth); return store.transaction(async tx => runDto(await ownRun(tx, auth, id))); },
    async listRuns(auth: TradingBuyer) { auth = buyer(auth); return store.transaction(async tx => (await tx.runs.find({ userId: auth.userId, agentId: auth.agentId })).map(runDto)); },
    async stopRun(auth: TradingBuyer, id: string) {
      auth = buyer(auth);
      const result = await store.transaction(async tx => { const run = await ownRun(tx, auth, id); const updated = { ...run, status: 'STOPPED' }; if (run.status === 'RUNNING') await tx.runs.replace(updated, { status: 'RUNNING' }); return runDto(run.status === 'RUNNING' ? updated : run); });
      const stillActive = await store.transaction(async tx => (await tx.runs.find({ userId: auth.userId, agentId: auth.agentId, status: 'RUNNING' })).some(run => run.expiresAt > now()));
      if (!stillActive) await onInactive?.(auth);
      return result;
    },
    async recordResult(auth: TradingBuyer, id: string, result: string, completed = false) {
      auth = buyer(auth); const output = await store.transaction(async tx => { const run = await ownRun(tx, auth, id); if (run.status !== 'RUNNING') return runDto(run); const updated = { ...run, result, status: completed ? 'COMPLETED' : run.status }; await tx.runs.replace(updated, { status: 'RUNNING' }); return runDto(updated); });
      if (completed && !(await service.listRuns(auth)).some(run => run.status === 'RUNNING' && new Date(run.expiresAt) > now())) await onInactive?.(auth);
      return output;
    },
    async activeRuns() { return store.transaction(async tx => (await tx.runs.find({ status: 'RUNNING' })).filter(run => run.expiresAt > now()).map(run => ({ run: runDto(run), auth: { userId: run.userId, agentId: run.agentId } }))); },
    async failRun(auth: TradingBuyer, id: string) {
      auth = buyer(auth);
      await store.transaction(async tx => { const run = await ownRun(tx, auth, id); if (run.status === 'RUNNING') await tx.runs.replace({ ...run, status: 'FAILED', result: '서버 실행 오류가 발생했습니다.' }, { status: 'RUNNING' }); });
      if (!(await service.listRuns(auth)).some(run => run.status === 'RUNNING' && new Date(run.expiresAt) > now())) await onInactive?.(auth);
    },
    async expireRuns() {
      const expired = await store.transaction(async tx => (await tx.runs.find({ status: 'RUNNING', expiresAt: { lte: now() } })).map(run => ({ userId: run.userId, agentId: run.agentId, id: run.id })));
      for (const run of expired) await service.stopRun(run, run.id);
    },
    executionInTransaction: getPolicyExecutionContext,
  };
  return service;
}
export type PolicyService = ReturnType<typeof createPolicyService>;
