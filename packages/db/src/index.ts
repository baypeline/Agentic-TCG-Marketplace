import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client.js';

export { PrismaClient };
export { seedDemoCatalog } from './seed.js';
export { readDemoScenarios, seedDemoScenarios } from './demo-scenarios.js';
export type { DemoScenarioPack } from './demo-scenarios.js';
export { readCatalogFixtures, seedCollectedCatalog, validateCatalogFixtures } from './catalog-fixtures.js';
export type { CatalogFixtures } from './catalog-fixtures.js';
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl, connectionTimeoutMillis: 5000 }) });
}
