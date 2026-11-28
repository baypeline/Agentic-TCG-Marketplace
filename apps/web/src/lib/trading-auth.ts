import { cookies } from 'next/headers';

export async function tradingAuthorization(request: Request) {
  const cookie = (await cookies()).get('tcg_session')?.value;
  return cookie ? `Bearer ${cookie}` : request.headers.get('authorization');
}
