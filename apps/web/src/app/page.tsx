import { redirect } from 'next/navigation';
import { getDiscovery } from '../server/discovery';
import { LandingView } from '../features/landing/landing-view';

export const dynamic = 'force-dynamic';
export default async function Home({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  // 기존 검색 URL을 열어도 새 검색 페이지로 이어진다.
  if (typeof params.q === 'string') redirect(`/cards?${new URLSearchParams({ q: params.q.trim().slice(0, 200) })}`);
  return <LandingView discovery={await getDiscovery()} />;
}
