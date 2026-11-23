import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { createPrismaCardIdentityStore, createPrismaCardCatalogWriter, createSetCollectionService, type SetCardSource } from '../src/index.js';

const integration = it.skipIf(!process.env.DATABASE_TEST_URL);
async function setup() {
  const prisma = createPrismaClient(process.env.DATABASE_TEST_URL!); const setId = `set-${randomUUID()}`;
  const externalIds = Array.from({ length: 5 }, (_, i) => `${setId}-${i + 1}`);
  const identity = createPrismaCardIdentityStore(prisma); const calls: string[] = []; let plans = 0;
  let failId: string | undefined;
  const source: SetCardSource = {
    async getSet() { plans++; return { setId, setName: 'Test Set', externalIds: [...externalIds] }; },
    async getCard(externalId) {
      calls.push(externalId);
      if (failId === externalId) throw new Error('test source failure');
      const id = await identity.getOrCreateId({ provider: 'TCGDEX', externalId, language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' });
      return { id, name: `Test ${externalId}`, game: 'POKEMON', setCode: setId, cardNumber: externalId.split('-').at(-1)!, language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' };
    },
  };
  return { prisma, setId, externalIds, calls, source, service: createSetCollectionService({ prisma, source }), get plans() { return plans; }, fail(id?: string) { failId = id; } };
}
async function fixture(run: (c: Awaited<ReturnType<typeof setup>>) => Promise<void>) {
  const c = await setup();
  try { await run(c); }
  finally {
    await c.prisma.cardVariant.deleteMany({ where: { setCode: c.setId } });
    await c.prisma.externalCardIdentity.deleteMany({ where: { externalId: { in: c.externalIds } } });
    await c.prisma.catalogCollectionRun.deleteMany({ where: { setId: c.setId } });
    await c.prisma.$disconnect();
  }
}
integration('중단·실패 뒤 저장된 계획과 체크포인트부터 재개하고 완료 재실행은 조회하지 않는다', async () => fixture(async c => {
  expect(await c.service.collectSet({ setId: c.setId, batchSize: 2, maxBatches: 1 })).toMatchObject({ status: 'PENDING', nextIndex: 2, storedThisRun: 2 });
  c.fail(c.externalIds[2]);
  await expect(c.service.collectSet({ setId: c.setId, batchSize: 2 })).rejects.toThrow('test source failure');
  expect(await c.prisma.catalogCollectionRun.findFirst({ where: { setId: c.setId } })).toMatchObject({ nextIndex: 2, status: 'FAILED', leaseToken: null });
  c.fail();
  expect(await c.service.collectSet({ setId: c.setId, batchSize: 2 })).toMatchObject({ status: 'COMPLETED', nextIndex: 5, resumedFrom: 2, storedThisRun: 3 });
  expect(c.plans).toBe(1);
  const calls = c.calls.length;
  expect(await c.service.collectSet({ setId: c.setId })).toMatchObject({ status: 'COMPLETED', storedThisRun: 0 });
  expect(c.calls).toHaveLength(calls);
  expect(await c.prisma.cardVariant.count({ where: { setCode: c.setId } })).toBe(5);
}));
integration('같은 세트의 KO 수집이 EN 체크포인트나 UUID를 덮어쓰지 않는다', async () => fixture(async c => {
  await c.service.collectSet({ setId: c.setId, batchSize: 1, maxBatches: 1 });
  const identity = createPrismaCardIdentityStore(c.prisma);
  const source: SetCardSource = { getSet: c.source.getSet, async getCard(externalId) {
    return { id: await identity.getOrCreateId({ provider: 'TCGDEX', externalId, language: 'KO', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' }), game: 'POKEMON', name: '한국어 카드', setCode: c.setId, cardNumber: externalId.split('-').at(-1)!, language: 'KO', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' };
  } };
  const ko = createSetCollectionService({ prisma: c.prisma, source, language: 'ko' });
  expect(await ko.collectSet({ setId: c.setId })).toMatchObject({ language: 'KO', status: 'COMPLETED', storedThisRun: 5 });
  expect(await c.prisma.catalogCollectionRun.findUnique({ where: { collectionTarget: { provider: 'TCGDEX', language: 'EN', setId: c.setId } } })).toMatchObject({ nextIndex: 1, status: 'PENDING' });
  expect(await c.service.collectSet({ setId: c.setId })).toMatchObject({ resumedFrom: 1, storedThisRun: 4 });
  expect(await c.prisma.cardVariant.count({ where: { setCode: c.setId } })).toBe(10);
  expect(await ko.collectSet({ setId: c.setId })).toMatchObject({ storedThisRun: 0 });
}));
integration('카드 저장 후 진행 기록 실패를 재현해도 UUID와 카드 수가 유지된다', async () => fixture(async c => {
  const writer = createPrismaCardCatalogWriter(c.prisma);
  const broken = createSetCollectionService({ prisma: c.prisma, source: c.source, writer: { async saveCards(input) { await writer.saveCards(input); throw new Error('crash after save'); } } });
  await expect(broken.collectSet({ setId: c.setId, batchSize: 2 })).rejects.toThrow('crash after save');
  const before = await c.prisma.cardVariant.findMany({ where: { setCode: c.setId }, select: { id: true } });
  expect(before).toHaveLength(2);
  expect(await c.service.collectSet({ setId: c.setId, batchSize: 2 })).toMatchObject({ resumedFrom: 0, nextIndex: 5, status: 'COMPLETED' });
  expect(await c.prisma.cardVariant.count({ where: { id: { in: before.map(row => row.id) } } })).toBe(2);
  expect(await c.prisma.cardVariant.count({ where: { setCode: c.setId } })).toBe(5);
}));
integration('실행 중인 세트의 동시 수집은 거부하고 만료된 잠금은 재획득한다', async () => fixture(async c => {
  await c.service.collectSet({ setId: c.setId, maxBatches: 1, batchSize: 1 });
  await c.prisma.catalogCollectionRun.updateMany({ where: { setId: c.setId }, data: { status: 'RUNNING', leaseToken: randomUUID(), leaseUntil: new Date(Date.now() + 300_000) } });
  await expect(c.service.collectSet({ setId: c.setId })).rejects.toMatchObject({ statusCode: 409 });
  await c.prisma.catalogCollectionRun.updateMany({ where: { setId: c.setId }, data: { leaseUntil: new Date(Date.now() - 1000) } });
  expect(await c.service.collectSet({ setId: c.setId })).toMatchObject({ status: 'COMPLETED', resumedFrom: 1 });
}));
integration('명시적 refresh만 목록을 다시 읽고 동일 UUID로 수집한다', async () => fixture(async c => {
  await c.service.collectSet({ setId: c.setId });
  const before = await c.prisma.cardVariant.findMany({ where: { setCode: c.setId }, orderBy: { id: 'asc' }, select: { id: true } });
  expect(await c.service.collectSet({ setId: c.setId, refresh: true })).toMatchObject({ status: 'COMPLETED', resumedFrom: 0, storedThisRun: 5 });
  expect(c.plans).toBe(2);
  expect(await c.prisma.cardVariant.findMany({ where: { setCode: c.setId }, orderBy: { id: 'asc' }, select: { id: true } })).toEqual(before);
}));
