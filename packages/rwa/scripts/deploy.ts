import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { config, parse } from 'dotenv';
import { createWalletClient, http, publicActions, keccak256, toBytes, type Hex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { marooTestnet } from '@tcg/payment-client/native';
import { cardMarketplaceAbi, cardVaultAbi } from '@tcg/payment-client/rwa';
import { createPrismaClient, readDemoScenarios, demoRowId, ensureMonetaryContext } from '@tcg/db';

const root=new URL('../../../',import.meta.url), envPath=new URL('.env',root);
config({path:envPath,quiet:true});
const journalPath=new URL('contracts/deployments/maroo-testnet.json',root);
async function main(){
 if(process.env.PAYMENT_CHAIN!=='maroo'||process.env.AGENT_SIGNING_MODE!=='server')throw new Error('Maroo server mode required');
 let envText=await readFile(envPath,'utf8'); const env=parse(envText);
 const updateEnv=async(values:Record<string,string>)=>{for(const [key,value]of Object.entries(values)){const re=new RegExp(`^${key}=.*$`,'m');envText=re.test(envText)?envText.replace(re,()=>`${key}=${value}`):`${envText.trimEnd()}\n${key}=${value}\n`;}await writeFile(envPath,envText,{mode:0o600});};
 const buyer=privateKeyToAccount(env.AGENT_SERVER_PRIVATE_KEY as Hex);
 const operatorKey=env.RWA_OPERATOR_PRIVATE_KEY||generatePrivateKey();
 await updateEnv({RWA_OPERATOR_PRIVATE_KEY:operatorKey});
 const operator=privateKeyToAccount(operatorKey as Hex);
 const chain=createWalletClient({chain:marooTestnet,transport:http(undefined,{timeout:20_000,retryCount:1})}).extend(publicActions);
 if(await chain.getChainId()!==450815)throw new Error('Wrong chain');
 let journal:Record<string,any>=JSON.parse(await readFile(journalPath,'utf8').catch(()=>'{"chainId":450815,"steps":{}}'));
 if(journal.chainId!==450815||journal.operator&&journal.operator.toLowerCase()!==operator.address.toLowerCase())throw new Error('Deployment identity mismatch');
 journal.operator=operator.address; await mkdir(new URL('contracts/deployments/',root),{recursive:true});
 const save=async()=>writeFile(journalPath,JSON.stringify(journal,null,2)+'\n');
 async function send(step:string,account:typeof operator,request:{to?:Hex;data?:Hex;value?:bigint}){
   const prior=journal.steps[step]; if(prior){const receipt=await chain.getTransactionReceipt({hash:prior.hash});if(receipt.status!=='success')throw new Error('Previous deployment step failed');return receipt;}
   const [nonce,gasPrice,gas,balance]=await Promise.all([chain.getTransactionCount({address:account.address,blockTag:'pending'}),chain.getGasPrice(),chain.estimateGas({account:account.address,...request}),chain.getBalance({address:account.address})]);
   if(gas*gasPrice>100n*10n**18n||balance<(request.value??0n)+gas*gasPrice)throw new Error('Insufficient deployment balance or gas cap');
   const raw=await account.signTransaction({chainId:450815,type:'legacy',nonce,gas,gasPrice,...request});
   const hash=keccak256(raw);journal.steps[step]={hash};await save();
   if(await chain.sendRawTransaction({serializedTransaction:raw})!==hash)throw new Error('Hash mismatch');
   const receipt=await chain.waitForTransactionReceipt({hash,timeout:90_000});if(receipt.status!=='success')throw new Error('Deployment step reverted');return receipt;
 }
 // Persisted funding step is never repeated; operator funds are separate from purchase budgets.
 if(!journal.steps.fund&&await chain.getBalance({address:operator.address})<80n*10n**18n)await send('fund',buyer,{to:operator.address,value:100n*10n**18n});
 const artifact=async(name:string)=>JSON.parse(await readFile(new URL(`contracts/out/${name}.sol/${name}.json`,root),'utf8'));
 const {encodeDeployData,encodeFunctionData}=await import('viem');
 if(!journal.nft){const a=await artifact('CardVaultNFT');const receipt=await send('deploy-nft',operator,{data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args:[operator.address]})});journal.nft=receipt.contractAddress;journal.deployBlock=receipt.blockNumber.toString();await save();}
 if(!journal.market){const a=await artifact('CardMarketplace');const receipt=await send('deploy-market',operator,{data:encodeDeployData({abi:a.abi,bytecode:a.bytecode.object,args:[journal.nft,operator.address,operator.address]})});journal.market=receipt.contractAddress;await save();}
 const nft=journal.nft.toLowerCase() as Hex,market=journal.market.toLowerCase() as Hex;
 const [nftCode,marketCode]=await Promise.all([chain.getCode({address:nft}),chain.getCode({address:market})]);
 if(!nftCode||!marketCode)throw new Error('Missing deployed code');
 journal.nftCodeHash=keccak256(nftCode);journal.marketCodeHash=keccak256(marketCode);await save();
 const db=createPrismaClient(env.DATABASE_URL!);
 try{
  await ensureMonetaryContext(db,'maroo'); const pack=await readDemoScenarios('maroo');
  for(const scene of pack.scenarios){
   const assetId=demoRowId(`rwa:${nft}:${scene.id}`),inventoryId=demoRowId(`rwa-inventory:${nft}:${scene.id}`),physicalHash=keccak256(toBytes(assetId));
   const card=await db.cardVariant.findUniqueOrThrow({where:{id:scene.cardId}});
   const metadata={name:`${scene.koreanName} · DEMO custody`,description:'Synthetic custody record. No physical card has been verified or deposited.',image:card.imageUrl,attributes:[{trait_type:'Custody',value:'DEMO'},{trait_type:'Physical ID',value:assetId}]};
   const json=JSON.stringify(metadata),digest=keccak256(toBytes(json)),uri='data:application/json;base64,'+Buffer.from(json).toString('base64');
   if(!journal.steps[`mint-${scene.id}`]){const tokenId=await chain.readContract({address:nft,abi:cardVaultAbi,functionName:'nextTokenId'});journal[`token-${scene.id}`]=tokenId.toString();await save();}
   const mint=await send(`mint-${scene.id}`,operator,{to:nft,data:encodeFunctionData({abi:cardVaultAbi,functionName:'mint',args:[operator.address,physicalHash,digest,uri]})});
   const tokenId=journal[`token-${scene.id}`];
   await db.$transaction(async tx=>{
    await tx.inventoryItem.upsert({where:{id:inventoryId},create:{id:inventoryId,cardVariantId:scene.cardId,ownerId:pack.sellerId,status:'AVAILABLE'},update:{}});
    await tx.rwaAsset.upsert({where:{id:assetId},create:{id:assetId,cardVariantId:scene.cardId,inventoryItemId:inventoryId,chainId:450815,nftAddress:nft,tokenId,physicalHash,metadataDigest:digest,metadataUri:uri,mintTxHash:mint.transactionHash,ownerWallet:operator.address.toLowerCase(),custodyMode:'DEMO'},update:{}});
   });
   await send(`approve-${scene.id}`,operator,{to:nft,data:encodeFunctionData({abi:cardVaultAbi,functionName:'approve',args:[market,BigInt(tokenId)]})});
   // A rerun never re-lists sold inventory: the original step receipt is reused.
   await send(`list-${scene.id}`,operator,{to:market,data:encodeFunctionData({abi:cardMarketplaceAbi,functionName:'createListing',args:[BigInt(tokenId),BigInt(scene.listingPrices[0]!),BigInt(Math.floor(Date.now()/1000)+30*86400)]})});
  }
 }finally{await db.$disconnect();}
 await updateEnv({RWA_ENABLED:'true',RWA_NFT_ADDRESS:nft,RWA_MARKET_ADDRESS:market,RWA_QUOTE_SIGNER:operator.address,RWA_NFT_CODE_HASH:journal.nftCodeHash,RWA_MARKET_CODE_HASH:journal.marketCodeHash,RWA_DEPLOY_BLOCK:journal.deployBlock});
 console.log(JSON.stringify({chainId:450815,nft,market,operator:operator.address,custodyMode:'DEMO',next:'pnpm facilitator:init; pnpm facilitator:up; restart API/Web'}));
}
main().catch(()=>{console.error('RWA deployment stopped. Inspect the persisted public deployment journal and wallet balance; no automatic replacement transactions. Secrets are not printed.');process.exitCode=1;});
