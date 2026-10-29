import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {createTaskServer} from '../api-server/server.js';

test('event booking: search, validation, concurrent seat conflict, retry, isolation, persistence and cancellation',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'encore-test-')),owner=randomUUID(),other=randomUUID();
 let server=await createTaskServer({dataFile:join(dir,'tasks.json')}),origin='';
 async function start(){await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));origin='http://127.0.0.1:'+(server.address() as {port:number}).port;}
 async function close(){await new Promise<void>((r,j)=>server.close(e=>e?j(e):r()));}
 async function call(route:string,method='GET',body?:unknown,client=owner){const r=await fetch(origin+'/api/v1/'+route,{method,headers:{'Content-Type':'application/json','X-Demo-Client-ID':client},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,data:await r.json()};}
 await start();
 try{
  assert.equal((await call('events')).data.events.length,6);
  assert.equal((await call('events?category=Music&city=Mumbai')).data.events[0].id,'jazz');
  assert.equal((await call('events?q=no-such-event')).data.events.length,0);
  assert.equal((await call('events?month=2026-12&max=800')).data.events[0].id,'comedy');
  assert.equal((await call('events?max=NaN')).status,400);
  assert.equal((await call('events/unknown')).status,404);
  assert.equal((await call('events/afterglow/seats')).data.seats.length,48);
  const payload={eventId:'afterglow',seats:['A1'],attendee:'Demo Guest',requestId:randomUUID()};
  assert.equal((await call('bookings','POST',{...payload,seats:['Z9']})).status,400);
  assert.equal((await call('bookings','POST',{...payload,seats:['A1','A1']})).status,400);
  assert.equal((await call('bookings','POST',null)).status,400);
  const results=await Promise.all([call('bookings','POST',payload),call('bookings','POST',{...payload,requestId:randomUUID()},other)]);
  assert.deepEqual(results.map(r=>r.status).sort(),[201,409]);
  const winner=results.findIndex(r=>r.status===201),client=winner===0?owner:other,booking=results[winner].data.booking;
  const retry=await call('bookings','POST',{...payload,requestId:booking.requestId},client);
  assert.equal(retry.data.booking.id,booking.id);
  assert.equal((await call('bookings','GET',undefined,winner===0?other:owner)).data.bookings.length,0);
  assert.equal((await call('bookings/'+booking.id+'/cancel','POST',{},winner===0?other:owner)).status,404);
  assert.equal((await call('events/afterglow')).data.event.available,47);
  await close();server=await createTaskServer({dataFile:join(dir,'tasks.json')});await start();
  assert.equal((await call('bookings','GET',undefined,client)).data.bookings.length,1);
  assert.equal((await call('bookings/'+booking.id+'/cancel','POST',{},client)).status,200);
  assert.equal((await call('events/afterglow')).data.event.available,48);
  assert.equal((await call('bookings','GET',undefined,client)).data.bookings[0].status,'cancelled');
 }finally{await close();await rm(dir,{recursive:true,force:true});}
});
