import { loadEnvFile } from 'node:process';
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { idSchema, type MarketPrice } from '@tcg/contracts';
import { createPrismaClient, type PrismaClient } from '@tcg/db';
import { createMarketPriceServices } from '../src/index.js';

let prisma: PrismaClient | undefined;
try {
  const { values } = parseArgs({ options: { 'card-id': { type: 'string' }, limit: { type: 'string', default: '200' }, file: { type: 'string' } } });
  const cardId = values['card-id'] ? idSchema.parse(values['card-id']) : undefined;
  const limit = z.coerce.number().int().min(1).max(500).parse(values.limit);
  loadEnvFile(new URL('../../../.env', import.meta.url));
  if (!process.env.DATABASE_URL) throw new Error('Missing DATABASE_URL');
  prisma = createPrismaClient(process.env.DATABASE_URL);
  const cards = await prisma.cardVariant.findMany({
    where: cardId ? { id: cardId } : { language: 'EN', externalIdentity: { provider: 'TCGDEX', language: 'EN' } },
    select: { id: true, name: true, setCode: true, cardNumber: true, language: true, edition: true, condition: true },
    orderBy: { id: 'asc' }, take: limit,
  });
  if (cardId && !cards.length) throw new Error('Card not found');
  const { marketPriceService, demoAdapter } = createMarketPriceServices({ prisma });
  const results = [];
  for (const card of cards) {
    const prices = await marketPriceService.getPrices(card.id);
    const byStatus: Partial<Record<MarketPrice['eligibility'], number>> = {};
    for (const price of prices.items) byStatus[price.eligibility] = (byStatus[price.eligibility] ?? 0) + 1;
    results.push({ ...card, referencePrices: prices.items.length, demoPrices: (await demoAdapter.getObservations(card.id)).length,
      eligibleProviders: new Set(prices.items.filter(price => price.eligibility === 'ELIGIBLE').map(price => price.provider)).size,
      unconfirmedAttributes: ['edition', 'condition'].filter(key => card[key as 'edition' | 'condition'].toUpperCase() === 'UNSPECIFIED'),
      byStatus,
    });
  }
  const report = { checkedAt: new Date().toISOString(), scope: cardId ? 'SINGLE_CARD' : 'TCGDEX_ENGLISH_CARDS', limit,
    summary: { checkedCards: results.length, cardsWithPrices: results.filter(card => card.referencePrices > 0).length,
      cardsWithEligiblePrices: results.filter(card => card.eligibleProviders > 0).length,
      cardsWithDemoPrices: results.filter(card => card.demoPrices > 0).length,
      cardsWithUnconfirmedAttributes: results.filter(card => card.unconfirmedAttributes.length > 0).length,
      referencePrices: results.reduce((sum, card) => sum + card.referencePrices, 0) }, cards: results };
  if (values.file) await writeFile(values.file, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify(values.file ? { ...report.summary, file: values.file } : report));
} catch {
  console.error('가격 준비 상태 확인 실패. 옵션과 DB 연결 및 Migration을 확인하세요.');
  process.exitCode = 1;
} finally { await prisma?.$disconnect(); }
