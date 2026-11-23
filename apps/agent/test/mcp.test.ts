import { createServer } from 'node:http';
import { once } from 'node:events';
import { mockCards } from '@tcg/aggregator';
import type { Valuation } from '@tcg/contracts';
import { expect, it } from 'vitest';
import { connectMcpCardServices } from '../src/index.js';

it('Streamable HTTP로 세션을 연결하고 카드 도구를 호출한 뒤 세션을 종료한다', async () => {
  const pikachu = mockCards[0]!;
  const valuation: Valuation = {
    cardVariantId: pikachu.id,
    status: 'AVAILABLE',
    currency: 'USDC',
    estimatedPrice: '12000000',
    confidence: 'LOW',
    sampleSize: 3,
    dataSource: 'MOCK',
    sourceSummary: ['테스트용 시세'],
    evaluatedAt: '2026-01-01T00:00:00Z',
  };
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  const requests: Array<{ method: string | undefined; sessionId: string | string[] | undefined; auth: string | undefined }> = [];
  const server = createServer(async (request, response) => {
    requests.push({
      method: request.method,
      sessionId: request.headers['mcp-session-id'],
      auth: request.headers.authorization,
    });
    if (request.method === 'DELETE') {
      response.writeHead(204).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }

    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(chunk);
    const message = JSON.parse(Buffer.concat(chunks).toString());
    const respond = (result: object) => {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    };
    switch (message.method) {
      case 'initialize':
        response.setHeader('mcp-session-id', 'test-session');
        respond({
          protocolVersion: message.params.protocolVersion,
          serverInfo: { name: 'test-card-mcp', version: '1.0.0' },
          capabilities: { tools: {} },
        });
        return;
      case 'notifications/initialized':
        response.writeHead(202).end();
        return;
      case 'tools/call': {
        calls.push(message.params);
        const { name, arguments: args } = message.params;
        if (name === 'get_valuation') {
          respond({ content: [{ type: 'text', text: JSON.stringify({ ok: true, data: valuation }) }] });
        } else if (args.query === 'tool-error') {
          respond({ isError: true, content: [{ type: 'text', text: 'test tool error' }] });
        } else if (args.query === 'invalid-result') {
          respond({ content: [], structuredContent: { ok: true, data: { items: [null] } } });
        } else {
          respond({ content: [], structuredContent: { ok: true, data: { items: [pikachu], nextCursor: null } } });
        }
        return;
      }
      default:
        response.writeHead(400).end();
    }
  });

  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('테스트 서버 주소가 없습니다.');
    const mcp = await connectMcpCardServices({
      url: `http://127.0.0.1:${address.port}/mcp`,
      headers: { Authorization: 'Bearer test-only' },
    });
    try {
      await expect(mcp.aggregatorService.searchCards({ query: 'Pikachu', limit: 10 })).resolves.toEqual([pikachu]);
      await expect(mcp.valuationService.getValuation(pikachu.id)).resolves.toEqual(valuation);
      await expect(mcp.valuationService.getValuation(mockCards[1]!.id)).rejects.toThrow('카드 ID가 요청과 일치하지 않습니다');
      await expect(mcp.aggregatorService.searchCards({ query: 'tool-error', limit: 10 })).rejects.toThrow('MCP 도구 호출에 실패했습니다');
      await expect(mcp.aggregatorService.searchCards({ query: 'invalid-result', limit: 10 })).rejects.toThrow();
      expect(calls.slice(0, 2)).toEqual([
        { name: 'search_cards', arguments: { query: 'Pikachu', limit: 10 } },
        { name: 'get_valuation', arguments: { cardVariantId: pikachu.id } },
      ]);
    } finally {
      await mcp.close();
    }
    expect(requests[0]).toMatchObject({ method: 'POST', auth: 'Bearer test-only' });
    expect(requests.at(-1)).toMatchObject({ method: 'DELETE', sessionId: 'test-session' });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
    });
  }
});
