import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskServer } from '../api-server/server.js';
import { tokenFor } from '../gateway/demo/web/mutation.js';
import { generateToken } from '../client-sdk/src/tokenGenerator.ts';

test('browser and SDK generate identical 30-second HMAC tokens',async()=>{
  const seed='0123456789abcdef0123456789abcdef';
  for(const time of [0,29999,30000,59999,1700000000000]) assert.equal(await tokenFor(seed,time),await generateToken(seed,time));
});

test('real API persists tasks, serializes concurrent writes, and records backend metrics',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'flux-task-test-'));
  const dataFile=join(dir,'tasks.json');
  let server=await createTaskServer({dataFile});
  async function listen(){await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return `http://127.0.0.1:${(server.address() as {port:number}).port}`;}
  let origin=await listen();
  async function call(path:string,method='GET',body?:unknown){const r=await fetch(origin+path,{method,headers:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};}
  async function close(){await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
  try{
    assert.equal((await call('/api/v1/tasks','POST',{title:' '})).status,400);
    const [one,two]=await Promise.all([call('/api/v1/tasks','POST',{title:'First task'}),call('/api/v1/tasks','POST',{title:'Second task'})]);
    assert.equal(one.status,201);assert.equal(two.status,201);
    assert.equal((await call('/api/v1/tasks')).body.tasks.length,2);
    assert.equal((await call('/api/v1/tasks/'+one.body.task.id,'PATCH',{done:true})).body.task.done,true);
    const metrics=await call('/internal/status');assert.equal(metrics.body.taskCount,2);assert.equal(metrics.body.writes,3);assert.equal(metrics.body.failures,1);
    assert.ok(metrics.body.recent.every((entry:{path:string})=>entry.path.startsWith('/api/v1/')));
    assert.equal((await call('/api/v1/tasks?q=FIRST&status=done')).body.tasks.length,1);
    assert.equal((await call('/api/v1/tasks?q=missing')).body.tasks.length,0);
    assert.equal((await call('/api/v1/tasks?status=bad')).status,400);
    const summary=(await call('/api/v1/summary')).body;
    assert.equal(summary.total,2);assert.equal(summary.completed,1);assert.equal(summary.pending,1);
    const preview=await call('/api/v1/preview','POST',{title:'  Draft  '});
    assert.equal(preview.status,200);assert.equal(preview.body.normalizedTitle,'Draft');assert.equal(preview.body.saved,false);
    assert.equal((await call('/api/v1/preview','POST',{title:''})).status,400);
    assert.equal((await call('/internal/status')).body.writes,3);
    await close();server=await createTaskServer({dataFile});origin=await listen();
    const restored=(await call('/api/v1/tasks')).body.tasks;assert.equal(restored.length,2);assert.equal(restored.find((task:{id:string})=>task.id===one.body.task.id).done,true);
    assert.equal((await call('/api/v1/tasks/'+two.body.task.id,'DELETE')).status,200);
    assert.equal((await call('/api/v1/tasks')).body.tasks.length,1);
  }finally{await close();await rm(dir,{recursive:true,force:true});}
});
