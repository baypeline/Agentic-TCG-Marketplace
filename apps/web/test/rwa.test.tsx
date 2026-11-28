import { expect,it } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RwaWorkspace } from '../src/features/rwa/rwa-workspace';
import { renderUI } from './render';
import { coreTradingPath } from '../src/lib/trading-proxy';
import type { RwaView } from '@tcg/contracts';
it('NFT 보관 데모·출금액·이미지·인출 잠금 동의와 판매 단계를 표시한다',()=>{
 const query=new QueryClient();
 const wallet=`0x${'1'.repeat(40)}`,id='00000000-0000-4000-8000-000000000001';
 const data:RwaView={custodyMode:'DEMO',wallet,role:'buyer',currency:'tOKRW',proceeds:'5000000000000000000',deployment:{market:`0x${'2'.repeat(40)}`,nft:`0x${'3'.repeat(40)}`},cards:[{id,name:'Eevee',imageUrl:'https://example.test/eevee.png'}],assets:[{id,inventoryItemId:id,cardVariantId:id,tokenId:'3',nftAddress:`0x${'3'.repeat(40)}`,ownerWallet:wallet,state:'ACTIVE',physicalHash:`0x${'a'.repeat(64)}`,metadataDigest:`0x${'b'.repeat(64)}`,mintTxHash:`0x${'c'.repeat(64)}`,custodyMode:'DEMO',listings:[],redemptions:[]}]};
 query.setQueryData(['rwa'],data);
 const html=renderUI(<QueryClientProvider client={query}><RwaWorkspace/></QueryClientProvider>);
 expect(html).toContain('실제 카드의 보관·감정·배송을 제공하지 않습니다');expect(html).toContain('5 tOKRW');expect(html).toContain('eevee.png');expect(html).toContain('alt="Eevee"');
 expect(html).toContain('1. 이 NFT 판매 승인');expect(html).toContain('2. 판매 등록');expect(html).toContain('NFT 잠금을 확인했어요');expect(html).toContain('판매 가격 (tOKRW)');expect(html).not.toContain('USDC');
 query.clear();
});
it('RWA 중계는 정해진 업무 경로와 요청 ID만 허용한다',()=>{
 const id='00000000-0000-4000-8000-000000000001';
 expect(coreTradingPath('GET',['rwa'])).toBe('/api/rwa');expect(coreTradingPath('POST',['rwa','actions'])).toBe('/api/rwa/actions');
 expect(coreTradingPath('GET',['rwa','actions',id])).toBe(`/api/rwa/actions/${id}`);
 expect(coreTradingPath('POST',['rwa','mint'])).toBeNull();expect(coreTradingPath('GET',['rwa','actions','..'])).toBeNull();expect(coreTradingPath('DELETE',['rwa','actions',id])).toBeNull();
});
