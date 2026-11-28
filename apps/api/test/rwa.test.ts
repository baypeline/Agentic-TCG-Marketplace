import Fastify from 'fastify';
import { expect,it,vi } from 'vitest';
import { createRwaPlugin } from '../src/rwa.js';
import type { RwaService } from '@tcg/rwa';
import { AppError } from '@tcg/contracts';
it('인증과 요청 키·고정 액션 스키마를 검사하고 지갑·임의 호출을 받지 않는다',async()=>{
 const app=Fastify();const action=vi.fn(async(_userId:string,..._args:unknown[])=>({id:'00000000-0000-4000-8000-000000000001',status:'COMPLETED',txHash:null}));
 app.decorateRequest('auth',null);app.addHook('onRequest',async request=>{if(request.headers.authorization==='Bearer buyer')request.auth={userId:'buyer'};});
 app.setErrorHandler((e,_q,r)=>r.code(e instanceof AppError?e.statusCode:400).send({error:'rejected'}));
 await app.register(createRwaPlugin({action} as unknown as RwaService));
 try{
 expect((await app.inject({method:'POST',url:'/api/rwa/actions',payload:{kind:'withdraw'}})).statusCode).toBe(401);
 const headers={authorization:'Bearer buyer','idempotency-key':'00000000-0000-4000-8000-000000000001'};
 expect((await app.inject({method:'POST',url:'/api/rwa/actions',headers,payload:{kind:'withdraw',privateKey:'secret'}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/rwa/actions',headers,payload:{kind:'withdraw',to:'0xattacker'}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/rwa/actions',headers,payload:{kind:'multicall'}})).statusCode).toBe(400);
 expect((await app.inject({method:'POST',url:'/api/rwa/actions',headers,payload:{kind:'withdraw'}})).statusCode).toBe(200);
 expect(action).toHaveBeenCalledTimes(1);expect(action.mock.calls[0]![0]).toBe('buyer');
 }finally{await app.close();}
});
