import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';
import {sealSession} from '../worker/auth.js';
import {localDatabase} from '../scripts/local-db.mjs';

const origin='https://dashboard.test';
const path=origin+'/api/john-cheers';
const base={SESSION_SECRET:'synthetic-cheer-log-session-secret-123456789012345'};

test('cheer log requires a current Stockroom session and same-origin writes',async()=>{
  const original=globalThis.fetch;
  let reads=0;
  globalThis.fetch=async()=>{reads++;return new Response(null,{status:403});};
  const db={prepare(){assert.fail('Unauthorized request must not access cheer records');}};
  try{
    assert.equal((await worker.fetch(new Request(path),{...base,DB:db})).status,401);
    assert.equal((await worker.fetch(new Request(path,{method:'POST',headers:{Origin:origin,'Content-Type':'application/json'},body:'{}'}),{...base,DB:db})).status,401);
    assert.equal(reads,0);
    const cookie=(await sealSession(new Request(origin),base,'bmc_stockroom_session=synthetic_cheer_source_session')).split(';')[0];
    assert.equal((await worker.fetch(new Request(path,{method:'POST',headers:{Cookie:cookie,Origin:'https://other.test','Content-Type':'application/json'},body:'{}'}),{...base,DB:db})).status,403);
    assert.equal(reads,0);
    assert.equal((await worker.fetch(new Request(path,{headers:{Cookie:cookie}}),{...base,DB:db})).status,401);
    assert.equal(reads,1);
    assert.equal((await worker.fetch(new Request(path,{method:'DELETE'}),{...base,DB:db})).status,405);
  }finally{globalThis.fetch=original;}
});

test('the authenticated cheer API saves, acknowledges and deduplicates rapid tap batches',async()=>{
  const original=globalThis.fetch;
  const db=localDatabase(':memory:');
  globalThis.fetch=async address=>{
    assert.equal(address,'https://bmc-stockroom.misty-jelly-1931.chatgpt.site/api/inventory');
    return Response.json({items:[]});
  };
  try{
    const env={...base,DB:db};
    const cookie=(await sealSession(new Request(origin),env,'bmc_stockroom_session=synthetic_cheer_source_session')).split(';')[0];
    const headers={Cookie:cookie,Origin:origin,'Content-Type':'application/json'};
    const events=Array.from({length:3},()=>({id:crypto.randomUUID(),occurredAt:new Date().toISOString()}));
    const save=()=>worker.fetch(new Request(path,{method:'POST',headers,body:JSON.stringify({events})}),env);
    const initial=await save();
    assert.equal(initial.status,200);
    assert.match(initial.headers.get('cache-control'),/private/);
    const result=await initial.json();
    assert.equal(result.total,3);
    assert.equal(result.weekCount,3);
    assert.deepEqual(result.acknowledgedIds,events.map(event=>event.id));
    assert.equal((await (await save()).json()).total,3);
    const read=await worker.fetch(new Request(path,{headers}),env);
    assert.equal(read.status,200);
    assert.equal((await read.json()).total,3);
    const tooLarge=await worker.fetch(new Request(path,{method:'POST',headers,body:JSON.stringify({events:'x'.repeat(9000)})}),env);
    assert.equal(tooLarge.status,413);
    assert.equal((await db.prepare('SELECT COUNT(*) AS total FROM warehouse_john_cheers').first()).total,3);
  }finally{globalThis.fetch=original;db.close();}
});
