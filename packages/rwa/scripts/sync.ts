import { config } from 'dotenv';
import { createPublicClient,http,type Hex } from 'viem';
import { readRwaDeployment } from '@tcg/payment-client/rwa';
import { marooTestnet } from '@tcg/payment-client/native';
import { createPrismaClient } from '@tcg/db';
import { createPrismaTradingStore,createTradingService } from '@tcg/trading';
import { createRwaService } from '../src/index.js';
config({path:new URL('../../../.env',import.meta.url),quiet:true});
async function main(){
 const env=process.env,deployment=readRwaDeployment(env);if(!deployment||env.PAYMENT_CHAIN!=='maroo')throw new Error();
 const running=await fetch(new URL('/health',env.CORE_API_URL!),{signal:AbortSignal.timeout(1500)}).then(r=>r.ok).catch(()=>false);if(running){console.error('Stop Core API before running the offline RWA indexer.');process.exitCode=1;return;}
 const db=createPrismaClient(env.DATABASE_URL!);try{
  const block=BigInt(env.RWA_DEPLOY_BLOCK!);
  if(process.argv.includes('--rebuild')){
   const chain=createPublicClient({chain:marooTestnet,transport:http()});
   const head=await chain.getBlock({blockTag:'finalized'});if(head.number===null)throw new Error();
   const ids:string[]=[];
   for(let from=block;from<=head.number;from+=500n){const logs=await chain.getLogs({address:[deployment.nft,deployment.market],fromBlock:from,toBlock:from+499n<head.number?from+499n:head.number});for(const log of logs)if(log.transactionHash&&log.logIndex!==null)ids.push(`450815:${log.transactionHash}:${log.logIndex}`);}
   await db.$transaction(async tx=>{await tx.rwaChainEvent.deleteMany({where:{id:{in:ids}}});await tx.rwaChainCursor.deleteMany({where:{id:`450815:${deployment.market}`}});});
  }
  const trading=createTradingService({store:createPrismaTradingStore(db),currency:'tOKRW'});
  const service=createRwaService({prisma:db,deployment,deployBlock:block,buyerKey:env.AGENT_SERVER_PRIVATE_KEY as Hex,operatorKey:env.RWA_OPERATOR_PRIVATE_KEY as Hex,buyerUserId:'00000000-0000-4000-8002-000000000002',sellerUserId:'00000000-0000-4000-8002-000000000001',releaseQuote:(userId,agentId,id)=>trading.releaseQuote({userId,agentId},id)});
  await service.sync();console.log(JSON.stringify({indexed:true,rebuild:process.argv.includes('--rebuild'),broadcast:false}));
 }finally{await db.$disconnect();}
}
main().catch(()=>{console.error('RWA index recovery stopped. Check RPC, public deployment manifest and DB; no transactions were broadcast.');process.exitCode=1;});
