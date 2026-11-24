import { randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { createPrismaClient } from '@tcg/db';
import { demoInventory } from '../src/index.js';

const databaseUrl = process.env.DATABASE_TEST_URL;
it.skipIf(!databaseUrl)('시연 seed 재실행이 기존 재고의 소유자와 상태를 덮어쓰지 않는다', async () => {
  const prisma = createPrismaClient(databaseUrl!);
  const ids = demoInventory.map(item => item.id);
  const before = await prisma.inventoryItem.findMany({ where: { id: { in: ids } } });
  const newIds = ids.filter(id => !before.some(item => item.id === id));
  const seed = () => promisify(execFile)(process.execPath, [fileURLToPath(import.meta.resolve('tsx/cli')), 'scripts/seed-demo.ts'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: { ...process.env, DATABASE_URL: databaseUrl },
  });
  try {
    await seed();
    expect(await prisma.inventoryItem.count({ where: { id: { in: ids } } })).toBe(6);
    if (newIds[0]) await prisma.inventoryItem.update({ where: { id: newIds[0] }, data: { ownerId: randomUUID(), status: 'LISTED' } });
    const first = await prisma.inventoryItem.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } });
    await seed();
    expect(await prisma.inventoryItem.findMany({ where: { id: { in: ids } }, orderBy: { id: 'asc' } })).toEqual(first);
  } finally {
    try { await prisma.inventoryItem.deleteMany({ where: { id: { in: newIds } } }); }
    finally { await prisma.$disconnect(); }
  }
});
