import type { Metadata } from 'next';
import { CollectionView } from '../../features/trading/collection-view';
export const metadata: Metadata = { title: '내 카드' };
export default function CollectionPage() { return <CollectionView />; }
