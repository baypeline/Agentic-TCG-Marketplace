import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { idSchema } from '@tcg/contracts';
import { createPrismaCardIdentityStore, createTcgdexCardAdapter, type ExternalCardReference } from '../src/index.js';

describe.skipIf(!process.env.DATABASE_TEST_URL)('외부 카드 UUID PostgreSQL 매핑', () => {
  let prisma: PrismaClient;
  const externalIds = new Set<string>();
  function reference(): ExternalCardReference {
    const externalId = `identity-test-${randomUUID()}`;
    externalIds.add(externalId);
    return { provider: 'TCGDEX', externalId, language: 'EN', edition: 'UNSPECIFIED', condition: 'UNSPECIFIED' };
  }
  beforeAll(() => { prisma = createPrismaClient(process.env.DATABASE_TEST_URL!); });
  afterEach(async () => {
    if (externalIds.size) await prisma.externalCardIdentity.deleteMany({ where: { provider: 'TCGDEX', externalId: { in: [...externalIds] } } });
    externalIds.clear();
  });
  afterAll(async () => { await prisma.$disconnect(); });

  it('Client를 종료하고 새로 연결해도 같은 내부 UUID와 역매핑을 반환한다', async () => {
    const ref = reference();
    const initial = createPrismaClient(process.env.DATABASE_TEST_URL!);
    let id: string;
    try { id = await createPrismaCardIdentityStore(initial).getOrCreateId(ref); }
    finally { await initial.$disconnect(); }
    expect(idSchema.safeParse(id!).success).toBe(true);
    const reconnected = createPrismaClient(process.env.DATABASE_TEST_URL!);
    try {
      const store = createPrismaCardIdentityStore(reconnected);
      expect(await store.getOrCreateId(ref)).toBe(id!);
      expect(await store.findById(id!)).toEqual(ref);
    } finally { await reconnected.$disconnect(); }
  });

  it('독립 Client의 동시 요청 16개가 하나의 매핑으로 수렴한다', async () => {
    const ref = reference();
    const other = createPrismaClient(process.env.DATABASE_TEST_URL!);
    try {
      const stores = [createPrismaCardIdentityStore(prisma), createPrismaCardIdentityStore(other)];
      const ids = await Promise.all(Array.from({ length: 16 }, (_, index) => stores[index % 2]!.getOrCreateId(ref)));
      expect(new Set(ids).size).toBe(1);
      expect(await prisma.externalCardIdentity.count({ where: ref })).toBe(1);
    } finally { await other.$disconnect(); }
  });

  it('정규화한 같은 참조는 재사용하고 언어·에디션·상태·외부 ID는 구분한다', async () => {
    const ref = reference();
    const store = createPrismaCardIdentityStore(prisma);
    const id = await store.getOrCreateId(ref);
    expect(await store.getOrCreateId({ ...ref, language: ' en ', edition: ' unspecified ', condition: ' unspecified ' })).toBe(id);
    const variants = [{ ...ref, language: 'JA' }, { ...ref, edition: 'HOLO' }, { ...ref, condition: 'NM' }, { ...ref, externalId: ref.externalId.toUpperCase() }];
    for (const variant of variants) externalIds.add(variant.externalId);
    const ids = await Promise.all(variants.map(variant => store.getOrCreateId(variant)));
    expect(new Set([id, ...ids]).size).toBe(5);
    expect(await prisma.externalCardIdentity.count({ where: { externalId: { in: [...externalIds] } } })).toBe(5);
  });

  it('DB 유일성 제약 자체도 동일 참조의 중복 생성을 차단한다', async () => {
    const ref = reference();
    await createPrismaCardIdentityStore(prisma).getOrCreateId(ref);
    await expect(prisma.externalCardIdentity.create({ data: ref })).rejects.toMatchObject({ code: 'P2002' });
  });

  it('없는 UUID는 매핑을 생성하지 않으며, 잘못된 참조도 저장하지 않는다', async () => {
    const ref = reference();
    const store = createPrismaCardIdentityStore(prisma);
    expect(await store.findById(randomUUID())).toBeNull();
    expect(await store.findById('invalid-id')).toBeNull();
    await expect(store.getOrCreateId({ ...ref, condition: ' ' })).rejects.toThrow();
    expect(await prisma.externalCardIdentity.count({ where: { externalId: ref.externalId } })).toBe(0);
  });

  it('외부 어댑터를 새로 만들어도 DB 매핑으로 내부 UUID 상세 조회가 가능하다', async () => {
    const ref = reference();
    const detail = { id: ref.externalId, localId: '58', name: 'Pikachu', set: { id: 'base1' } };
    const fetcher: typeof globalThis.fetch = async input => {
      const url = new URL(String(input));
      if (url.pathname.endsWith('/series/tcgp')) return Response.json({ id: 'tcgp', sets: [] });
      if (url.pathname.endsWith('/cards')) return Response.json([{ id: detail.id, localId: detail.localId, name: detail.name }]);
      if (url.pathname.endsWith('/cards/' + detail.id)) return Response.json(detail);
      throw new Error('Unexpected provider request');
    };
    const adapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createPrismaCardIdentityStore(prisma) });
    const [card] = await adapter.searchCards({ query: 'Pikachu', limit: 1 });
    expect(card).toBeDefined();
    const other = createPrismaClient(process.env.DATABASE_TEST_URL!);
    try {
      const freshAdapter = createTcgdexCardAdapter({ fetch: fetcher, identityStore: createPrismaCardIdentityStore(other) });
      expect(await freshAdapter.getCardVariant(card!.id)).toEqual(card);
      expect(await freshAdapter.getCardVariant(card!.id.toUpperCase())).toEqual(card);
      expect(await other.cardVariant.findUnique({ where: { id: card!.id } })).toBeNull(); // 이번 단계는 UUID 예약만 수행
    } finally { await other.$disconnect(); }
  });
});
