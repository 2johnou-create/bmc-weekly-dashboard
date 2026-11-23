import test from 'node:test';
import assert from 'node:assert/strict';
import {createHandler} from '../src/server.mjs';

const token='synthetic_reader_idempotency_token_123456789012345';
const fixedNow=new Date('2026-11-23T00:00:00Z');
const post=(requestId,path='/v1/sync')=>new Request('https://reader.test'+path,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({weekStart:'2026-11-23',...(requestId!==undefined?{requestId}:{})})});
const flush=()=>new Promise(resolve=>setImmediate(resolve));

test('a keyed startup replay returns the same running job without queuing an extra weekly read',async()=>{
  let calls=0,options,release;
  const handler=createHandler({token,now:()=>fixedNow,reader:{read(_week,value){calls++;options=value;return new Promise(resolve=>{release=resolve;});}}});
  const key=crypto.randomUUID();
  const first=await(await handler(post(key))).json();await flush();
  assert.equal(options.refreshControl.hasPending(),false);
  for(let count=0;count<3;count++)assert.equal((await(await handler(post(key))).json()).jobId,first.jobId);
  assert.equal(calls,1);assert.equal(options.refreshControl.hasPending(),false);
  const manualKey=crypto.randomUUID();
  assert.equal((await(await handler(post(manualKey))).json()).jobId,first.jobId);
  assert.equal(options.refreshControl.take(),true);
  await handler(post(manualKey));assert.equal(options.refreshControl.hasPending(),false);
  options.refreshControl.sealIfIdle();release({production:{roastedKg:20,scheduledKg:0}});await flush();
});

test('a keyed completed response remains idempotent while a new manual key starts a fresh job',async()=>{
  let calls=0;
  const handler=createHandler({token,now:()=>fixedNow,reader:{read(_week,{refreshControl}){calls++;refreshControl.take();refreshControl.sealIfIdle();return {sequence:calls};}}});
  const key=crypto.randomUUID();const first=await(await handler(post(key))).json();await flush();
  const replay=await handler(post(key));const saved=await replay.json();
  assert.equal(replay.status,200);assert.equal(saved.status,'complete');assert.equal(saved.jobId,first.jobId);assert.equal(calls,1);
  const next=await(await handler(post(crypto.randomUUID()))).json();assert.notEqual(next.jobId,first.jobId);await flush();assert.equal(calls,2);
});

test('invalid or misplaced idempotency IDs are rejected before a browser read',async()=>{
  let calls=0;const handler=createHandler({token,now:()=>fixedNow,reader:{read(){calls++;return {};}}});
  for(const key of ['',null,123,{},'../elsewhere','__proto__','a'.repeat(1000),'11111111-2222-1333-8444-555555555555']) {
    assert.equal((await handler(post(key))).status,400,String(key));
  }
  assert.equal((await handler(post(crypto.randomUUID(),'/v1/weekly'))).status,400);
  assert.equal(calls,0);
});

test('idempotency history stays bounded without evicting active replay protection',async()=>{
  let options,release;
  const handler=createHandler({token,now:()=>fixedNow,reader:{read(_week,value){options=value;return new Promise(resolve=>{release=resolve;});}}});
  const firstKey=crypto.randomUUID();const first=await(await handler(post(firstKey))).json();await flush();
  for(let index=1;index<512;index++)assert.equal((await handler(post(crypto.randomUUID()))).status,202);
  const blocked=await handler(post(crypto.randomUUID()));assert.equal(blocked.status,503);
  assert.equal((await(await handler(post(firstKey))).json()).jobId,first.jobId);
  options.refreshControl.take();options.refreshControl.sealIfIdle();release({});await flush();
});
