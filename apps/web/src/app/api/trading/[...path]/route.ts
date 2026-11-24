import { tradingAuthorization } from '../../../../lib/trading-auth';
import { proxyTrading } from '../../../../lib/trading-proxy';
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) {
  return proxyTrading(request, (await context.params).path, await tradingAuthorization(request), process.env.CORE_API_URL ?? 'http://127.0.0.1:4000');
}
export { handle as GET, handle as POST, handle as PUT, handle as DELETE };
