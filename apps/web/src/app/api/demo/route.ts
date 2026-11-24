import { demoStatusSchema } from '@tcg/contracts';

export async function GET() {
  try {
    const response = await fetch(new URL('/api/demo', process.env.CORE_API_URL ?? 'http://127.0.0.1:4000'), { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('Unavailable');
    return Response.json(demoStatusSchema.parse(await response.json()), { headers: { 'cache-control': 'no-store' } });
  } catch { return Response.json({ message: '데모 설정을 확인하지 못했습니다.' }, { status: 502 }); }
}
