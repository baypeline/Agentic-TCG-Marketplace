import type { Metadata } from 'next';
import { getCatalog } from '../../server/api';
import { CatalogView } from '../../features/catalog/catalog-view';
import { RequestState } from '../../components/request-state';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: '카드 검색' };

export default async function Cards({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const query = typeof params.q === 'string' ? params.q.trim().slice(0, 200) : '';
  let items;
  try { items = await getCatalog(query); }
  catch { return <RequestState title="카드 목록을 불러오지 못했습니다." message="잠시 후 다시 시도하세요. 검색어는 주소에 유지됩니다." />; }
  return <CatalogView query={query} items={items} />;
}
