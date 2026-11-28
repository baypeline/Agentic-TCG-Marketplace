import { expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { encodeFunctionData, keccak256, toBytes } from 'viem';
import { signRwaPayment, inspectRwaPayment, quoteDomain, quoteMessage, quoteTypes, cardMarketplaceAbi, type RwaDeployment, type RwaQuote } from '../src/rwa.js';
const operator=privateKeyToAccount(`0x${'11'.repeat(32)}`),buyer=privateKeyToAccount(`0x${'22'.repeat(32)}`);
async function fixture(){
 const deployment:RwaDeployment={market:`0x${'33'.repeat(20)}`,nft:`0x${'44'.repeat(20)}`,marketCodeHash:`0x${'55'.repeat(32)}`,nftCodeHash:`0x${'66'.repeat(32)}`,quoteSigner:operator.address};
 const id='00000000-0000-4000-8000-000000000001',expiresAt=new Date(Date.now()+60_000).toISOString();
 const q:RwaQuote={quoteId:keccak256(toBytes(id)),listingId:'1',nft:deployment.nft,tokenId:'1',buyer:buyer.address.toLowerCase() as `0x${string}`,recipient:buyer.address.toLowerCase() as `0x${string}`,seller:operator.address.toLowerCase() as `0x${string}`,amount:'5000000000000000000',deadline:String(Math.floor(Date.parse(expiresAt)/1000)),policyHash:keccak256(toBytes('policy'))};
 const signature=await operator.signTypedData({domain:quoteDomain(deployment.market),types:quoteTypes,primaryType:'Quote',message:quoteMessage(q)});
 const data=encodeFunctionData({abi:cardMarketplaceAbi,functionName:'buyListing',args:[quoteMessage(q),signature]});
 const requirements={scheme:'maroo-rwa',network:'eip155:450815' as const,asset:'native:tOKRW',payTo:deployment.market,amount:q.amount,maxTimeoutSeconds:60,extra:{tcgQuoteId:id,expiresAt,rwa:{quote:q,signature,calldataHash:keccak256(data)}}};
 return {deployment,requirements};
}
it('RWA 견적과 구매자 서명을 주문·컨트랙트·calldata에 결합한다',async()=>{
 const f=await fixture(); const payload=await signRwaPayment(f.requirements,buyer,f.deployment,{nonce:7,gas:200000n,gasPrice:9_000_000_000_000n});
 expect(await inspectRwaPayment(payload,f.requirements,f.deployment)).toMatchObject({payer:buyer.address,tx:{nonce:7,value:5n*10n**18n}});
 await expect(inspectRwaPayment(payload,{...f.requirements,amount:'6000000000000000000'},f.deployment)).rejects.toThrow();
 await expect(inspectRwaPayment(payload,f.requirements,{...f.deployment,market:`0x${'77'.repeat(20)}`})).rejects.toThrow();
 const changed=structuredClone(f.requirements);changed.extra.rwa.quote.tokenId='2';
 await expect(inspectRwaPayment(payload,changed,f.deployment)).rejects.toThrow();
});
it('다른 지갑·과도한 가스·변조한 지급 수락을 거부한다',async()=>{
 const f=await fixture();
 await expect(signRwaPayment(f.requirements,operator,f.deployment,{nonce:0,gas:200000n,gasPrice:1n})).rejects.toThrow();
 await expect(signRwaPayment(f.requirements,buyer,f.deployment,{nonce:0,gas:1000001n,gasPrice:1n})).rejects.toThrow();
 const payload=await signRwaPayment(f.requirements,buyer,f.deployment,{nonce:0,gas:200000n,gasPrice:1n});
 payload.accepted={...payload.accepted,amount:'1'};
 await expect(inspectRwaPayment(payload,f.requirements,f.deployment)).rejects.toThrow();
});
