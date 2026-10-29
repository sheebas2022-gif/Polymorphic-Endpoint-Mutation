import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requestPath,tokenFor} from '../gateway/demo/web/mutation.js';
const seed='0123456789abcdef0123456789abcdef';
test('client token modes build distinct routes and preserve query strings',async()=>{
 const time=1700000000000,window=30,route='events?q=music';
 for(const [mode,shift] of [['current',0],['previous',-1],['expired',-3],['future',1]] as const){
  assert.equal(await requestPath(seed,time,window,route,mode),'/api/v1/'+await tokenFor(seed,time+shift*30000,window)+'/'+route);
 }
 assert.equal(await requestPath(seed,time,window,route,'invalid'),'/api/v1/zzzzzzzz/'+route);
 assert.equal(await requestPath(seed,time,window,route,'missing'),'/api/v1/'+route);
 await assert.rejects(()=>requestPath(seed,time,window,route,'unknown'));
});
test('all six modes affect real GET and POST requests at the gateway',{skip:!process.env.E2E_ORIGIN},async()=>{
 const origin=process.env.E2E_ORIGIN!;
 for(const mode of ['current','previous','invalid','expired','future','missing']){
  const config=await (await fetch(origin+'/demo/client-config')).json();
  const expected=['current','previous'].includes(mode)?200:404;
  for(const method of ['GET','POST']){
   const path=await requestPath(config.seed,Date.now(),config.windowSeconds,'checkout',mode);
   const response=await fetch(origin+path,{method,body:method==='POST'?'demo=token-mode':undefined});
   assert.equal(response.status,expected,method+' '+mode);
  }
 }
});
