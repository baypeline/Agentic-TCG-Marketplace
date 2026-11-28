'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styled from '@emotion/styled';
import { rwaViewSchema, rwaActionSchema, type RwaView } from '@tcg/contracts';
import { formatUsdc } from '../../lib/formatters';
import { parseUsdcInput } from '../trading/demo-model';
import { useAgentPanelStore } from '../../stores/agent-panel';
const explorer='https://explorer-testnet.maroo.io';
const labels:Record<string,string>={ACTIVE:'보유 중',LISTED:'판매 예치 중',REQUESTED:'인출 요청 · NFT 잠금',RELEASE_APPROVED:'반출 승인',REDEEMED:'인출 완료 · NFT 소각',CANCELLED:'취소',COMPLETED:'완료',FAILED:'실패',PENDING:'체인 확인 중',PREPARING:'전송 준비 확인 필요'};
export function RwaWorkspace(){
 const queryClient=useQueryClient(),openAgent=useAgentPanelStore(s=>s.setChatOpen);
 const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[pending,setPending]=useState<string|null>(null),[tx,setTx]=useState<string|null>(null);
 const query=useQuery({queryKey:['rwa'],queryFn:async()=>{const r=await fetch('/api/trading/rwa',{cache:'no-store'});if(!r.ok)throw new Error(r.status===404?'카드 NFT 데모가 아직 활성화되지 않았어요.':'카드 NFT를 불러오지 못했어요.');return rwaViewSchema.parse(await r.json());}});
 const pendingKey=query.data?`tcg:rwa:pending:${query.data.wallet.toLowerCase()}`:null;
 useEffect(()=>{if(pendingKey){const id=sessionStorage.getItem(pendingKey);if(id){setPending(id);setMessage('이전에 제출한 작업이 있어요. 새 요청 대신 기존 상태를 확인해 주세요.');}}},[pendingKey]);
 function remember(id:string|null){setPending(id);if(pendingKey){if(id)sessionStorage.setItem(pendingKey,id);else sessionStorage.removeItem(pendingKey);}}
 async function act(kind:string,assetId?:string,extra:Record<string,string>={}){
  if(busy||pending)return;setBusy(true);setMessage('트랜잭션을 전송하고 확인하고 있어요.');
  const id=crypto.randomUUID(); remember(id);
  try{const r=await fetch('/api/trading/rwa/actions',{method:'POST',headers:{'content-type':'application/json','idempotency-key':id},body:JSON.stringify({kind,assetId,...extra})});if(!r.ok)throw new Error('요청에 실패했어요. 같은 요청 상태를 확인해 주세요.');const result=rwaActionSchema.parse(await r.json());setTx(result.txHash);setMessage(labels[result.status]??result.status);if(['COMPLETED','FAILED'].includes(result.status))remember(null);await queryClient.invalidateQueries();}catch(e){setMessage(e instanceof Error?e.message:'상태 확인이 필요해요.');}finally{setBusy(false);}
 }
 async function check(){if(!pending||busy)return;setBusy(true);try{const r=await fetch(`/api/trading/rwa/actions/${pending}`);if(!r.ok)throw new Error();const result=rwaActionSchema.parse(await r.json());setTx(result.txHash);setMessage(labels[result.status]??result.status);if(['COMPLETED','FAILED'].includes(result.status))remember(null);await queryClient.invalidateQueries();}catch{setMessage('기존 요청을 확인하지 못했어요. 새 요청 대신 다시 확인해 주세요.');}finally{setBusy(false);}}
 function ask(name:string){openAgent(true);window.dispatchEvent(new CustomEvent('tcg:agent-prompt',{detail:`${name} 카드의 NFT 매물을 찾아줘. 일반 카드 대신 NFT 매물을 구매하고 싶어.`}));}
 const data=query.data;
 return <Screen><Heading><div><h1>카드 NFT</h1><p>실물은 보관하고, 소유권은 지갑으로 주고받아요.</p></div><Button disabled={busy||query.isFetching} onClick={()=>void query.refetch()}>상태 새로고침</Button></Heading><Notice>테스트넷 데모 · 보관 기록은 합성 데이터이며 실제 카드의 보관·감정·배송을 제공하지 않습니다.</Notice>
 {query.isPending&&<p role="status">NFT와 보관 정보를 불러오고 있어요.</p>}{query.error&&<p role="alert">{query.error.message}</p>}
 {data&&<><Summary><div><span>연결된 {data.role==='custodian'?'보관자':'구매자'} 지갑</span><a href={`${explorer}/address/${data.wallet}`} target="_blank" rel="noreferrer">{data.wallet.slice(0,8)}…{data.wallet.slice(-6)}</a></div><div><span>출금 가능한 판매 대금</span><strong>{formatUsdc(data.proceeds,'tOKRW')}</strong></div><Button disabled={busy||!!pending||data.proceeds==='0'} onClick={()=>void act('withdraw')}>내 지갑으로 출금</Button></Summary><Note>결제와 NFT 이전은 함께 처리돼요. 가스비는 별도이며, 판매 대금은 마켓 컨트랙트에 적립됩니다.</Note>
 <Grid>{data.assets.map(asset=><Asset key={asset.id} asset={asset} data={data} disabled={busy||!!pending} action={act} ask={ask}/>)}</Grid></>}
 {message&&<Feedback role="status" aria-live="polite"><p>{message}</p>{tx&&<a href={`${explorer}/tx/${tx}`} target="_blank" rel="noreferrer">트랜잭션 확인</a>}{pending&&<Button disabled={busy} onClick={()=>void check()}>기존 요청 상태 확인</Button>}</Feedback>}</Screen>;
}
function Asset({asset,data,disabled,action,ask}:{asset:RwaView['assets'][number];data:RwaView;disabled:boolean;action:(kind:string,id?:string,extra?:Record<string,string>)=>Promise<void>;ask:(name:string)=>void}){
 const [price,setPrice]=useState(''),[confirm,setConfirm]=useState(false),[error,setError]=useState('');
 const card=data.cards.find(c=>c.id===asset.cardVariantId),name=card?.localizedNames?.find(n=>n.locale==='ko')?.name??card?.name??'카드';
 const mine=asset.ownerWallet.toLowerCase()===data.wallet.toLowerCase(),listing=asset.listings.find(l=>['ACTIVE','RESERVED'].includes(l.status)),redemption=asset.redemptions.find(r=>['REQUESTED','RELEASE_APPROVED'].includes(r.status));
 return <Card><Art>{card?.imageUrl?<img src={card.imageUrl} alt={name} loading="lazy"/>:<p>카드 이미지 없음</p>}</Art><Info><State>{labels[asset.state]??asset.state}</State><h2>{name}</h2><a href={`${explorer}/token/${asset.nftAddress}/instance/${asset.tokenId}`} target="_blank" rel="noreferrer">NFT #{asset.tokenId} 확인</a><Note>데모 보관 · 개체 {asset.id.slice(0,8)}</Note>
 {asset.state==='LISTED'&&listing&&<><strong>{formatUsdc(listing.price,'tOKRW')}</strong>{mine?<Button disabled={disabled} onClick={()=>void action('cancel-listing',asset.id,{listingId:listing.id})}>판매 취소 · NFT 반환</Button>:<Button disabled={disabled||listing.status!=='ACTIVE'} onClick={()=>ask(name)}>에이전트에서 NFT 매물 보기</Button>}</>}
 {mine&&asset.state==='ACTIVE'&&<><label htmlFor={`price-${asset.id}`}>판매 가격 (tOKRW)</label><input id={`price-${asset.id}`} inputMode="decimal" value={price} onChange={e=>setPrice(e.target.value)}/><Buttons><Button disabled={disabled} onClick={()=>void action('approve-nft',asset.id)}>1. 이 NFT 판매 승인</Button><Button disabled={disabled} onClick={()=>{const amount=parseUsdcInput(price,'tOKRW');if(!amount){setError('0보다 큰 판매 가격을 입력해 주세요.');return;}setError('');void action('list',asset.id,{price:amount});}}>2. 판매 등록 · NFT 예치</Button></Buttons>{error&&<p role="alert">{error}</p>}
 <details><summary>실물 인출 시뮬레이션</summary><Note>요청하면 NFT를 잠그고 거래를 중지합니다. 보관자 반출 승인 전에는 취소할 수 있어요. 실제 배송은 하지 않습니다.</Note><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> NFT 잠금을 확인했어요.</label><Button disabled={disabled||!confirm} onClick={()=>void action('redeem',asset.id)}>인출 요청 · NFT 잠금</Button></details></>}
 {redemption&&<><Note>{labels[redemption.status]}</Note>{mine&&redemption.status==='REQUESTED'&&<Button disabled={disabled} onClick={()=>void action('cancel-redemption',asset.id,{redemptionId:redemption.id})}>인출 요청 취소</Button>}{data.role==='custodian'&&<>{redemption.status==='REQUESTED'?<Button disabled={disabled} onClick={()=>void action('approve-release',asset.id,{redemptionId:redemption.id})}>데모 반출 승인</Button>:<><Button disabled={disabled} onClick={()=>void action('abort-release',asset.id,{redemptionId:redemption.id})}>미반출 · 승인 취소</Button><label><input type="checkbox" checked={confirm} onChange={e=>setConfirm(e.target.checked)}/> 데모 반출 완료와 NFT 소각을 확인했어요.</label><Button disabled={disabled||!confirm} onClick={()=>void action('finalize-redemption',asset.id,{redemptionId:redemption.id})}>인출 완료 · NFT 소각</Button></>}</>}</>}
 </Info></Card>;
}
const Screen=styled.section({display:'grid',gap:24});
const Heading=styled.div(({theme})=>({display:'flex',justifyContent:'space-between',alignItems:'center',gap:20,'& h1':{fontSize:32,marginBottom:8},'& p':{color:theme.color.muted},'@media(max-width:639px)':{alignItems:'start',flexDirection:'column'}}));
const Notice=styled.p(({theme})=>({padding:16,background:theme.color.demoBg,color:theme.color.demo,fontSize:14,lineHeight:1.7}));
const Summary=styled.div(({theme})=>({display:'flex',flexWrap:'wrap',alignItems:'center',gap:32,padding:'24px 0',borderBottom:`1px solid ${theme.color.line}`,'& div':{display:'grid',gap:8},'& span':{fontSize:13,color:theme.color.muted},'& a':{color:theme.color.link}}));
const Grid=styled.div({display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(min(100%,310px),1fr))',gap:28});
const Card=styled.article(({theme})=>({borderTop:`1px solid ${theme.color.line}`,paddingTop:24,display:'grid',alignContent:'start',gap:20}));
const Art=styled.div(({theme})=>({background:theme.color.soft,padding:24,display:'grid',placeItems:'center',minHeight:300,'& img':{width:'auto',maxWidth:'100%',height:280,objectFit:'contain',filter:'drop-shadow(0 10px 12px rgba(30,20,30,.12))'}}));
const Info=styled.div(({theme})=>({display:'grid',gap:12,'& h2':{fontSize:23},'& a':{color:theme.color.link},'& input:not([type=checkbox])':{padding:12,border:`1px solid ${theme.color.input}`,borderRadius:6,width:'100%'},'& details':{marginTop:12},'& summary':{cursor:'pointer',padding:'12px 0'},'& label':{fontSize:14},'& input[type=checkbox]':{marginRight:8}}));
const State=styled.span(({theme})=>({fontSize:13,color:theme.color.muted}));
const Note=styled.p(({theme})=>({fontSize:13,color:theme.color.muted,lineHeight:1.7}));
const Buttons=styled.div({display:'flex',flexWrap:'wrap',gap:8});
const Button=styled.button(({theme})=>({minHeight:44,padding:'10px 14px',border:`1px solid ${theme.color.line}`,borderRadius:6,background:theme.color.surface,color:theme.color.ink,cursor:'pointer',transition:'background 150ms','&:hover:not(:disabled)':{background:theme.color.soft},'&:focus-visible':{outline:`2px solid ${theme.color.focus}`,outlineOffset:3},'&:disabled':{opacity:.5,cursor:'default'},'@media(prefers-reduced-motion:reduce)':{transition:'none'}}));
const Feedback=styled.div(({theme})=>({position:'sticky',bottom:12,padding:16,background:theme.color.surface,border:`1px solid ${theme.color.line}`,boxShadow:'0 4px 20px rgba(30,20,30,.08)',display:'flex',gap:16,flexWrap:'wrap',alignItems:'center','& a':{color:theme.color.link}}));
