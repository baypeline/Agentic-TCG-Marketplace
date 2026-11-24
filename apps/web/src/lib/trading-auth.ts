import { cookies } from 'next/headers';

export async function tradingAuthorization(request: Request) {
  const cookie = (await cookies()).get('tcg_session')?.value;
  const hostname = new URL(`http://${request.headers.get('host') ?? new URL(request.url).host}`).hostname;
  const role = process.env.NODE_ENV !== 'production' && ['127.0.0.1','localhost','[::1]'].includes(hostname) ? process.env.WEB_DEMO_ROLE : undefined;
  const demo = role === 'buyer' ? process.env.DEMO_BUYER_TOKEN : role === 'seller' ? process.env.DEMO_SELLER_TOKEN : undefined;
  return request.headers.get('authorization') ?? (cookie ? `Bearer ${cookie}` : demo ? `Bearer ${demo}` : null);
}
