import assert from 'node:assert/strict';
import test from 'node:test';
import worker from '../worker/index.js';
import {sealSession} from '../worker/auth.js';
import {dashboardWeek} from '../worker/metrics.js';

const origin='https://dashboard.test';
const base={SESSION_SECRET:'synthetic-dispatch-poll-session-secret-123456789012345',DASHBOARD_DISPATCH_URL:'https://bmc-dispatch-delivery.misty-jelly-1931.chatgpt.site/api/integrations/dashboard/weekly',DISPATCH_READ_TOKEN:'synthetic-server-dispatch-read-token'};

test('Dispatch polling requires current Stockroom access before reading client completion data',async()=>{
  const original=globalThis.fetch;let reads=0;
  globalThis.fetch=async()=>{reads++;return new Response(null,{status:403});};
  try{
    assert.equal((await worker.fetch(new Request(origin+'/api/dispatch-status'),base)).status,401);
    assert.equal(reads,0);
    assert.equal((await worker.fetch(new Request(origin+'/api/dispatch-status',{method:'POST'}),base)).status,405);
    const cookie=(await sealSession(new Request(origin),base,'bmc_stockroom_session=synthetic_dispatch_poll_session')).split(';')[0];
    assert.equal((await worker.fetch(new Request(origin+'/api/dispatch-status',{headers:{Cookie:cookie}}),base)).status,401);
    assert.equal(reads,1);
  }finally{globalThis.fetch=original;}
});

test('the narrow Dispatch endpoint rereads the live feed without mixing clients and orders or leaking source-only fields',async()=>{
  const original=globalThis.fetch;let count=1;let dispatchReads=0;
  const weekStart=dashboardWeek().start;
  globalThis.fetch=async(address,options)=>{
    const url=new URL(address);
    if(url.hostname==='bmc-stockroom.misty-jelly-1931.chatgpt.site')return Response.json({items:[]});
    assert.equal(url.hostname,'bmc-dispatch-delivery.misty-jelly-1931.chatgpt.site');
    assert.equal(url.searchParams.get('week'),weekStart);
    assert.equal(options.headers.Authorization,'Bearer '+base.DISPATCH_READ_TOKEN);
    dispatchReads++;
    return Response.json({schemaVersion:'1.0',sourceSystem:'bmc-dispatch',weekStart,sourceUpdatedAt:new Date().toISOString(),planStatus:'confirmed-weekly-import',
      wholesale:{orders:10,completedOrders:3,pendingOrders:7,scheduledOrders:10,scheduledPendingOrders:7},delivery:{deliveredOrders:3},
      clientCompletions:{count,items:Array.from({length:count},(_,i)=>({clientId:'client-'+i,name:'Synthetic cafe '+i,completedAt:new Date().toISOString(),address:'PRIVATE_ADDRESS',phone:'PRIVATE_PHONE'})),latestCompletedAt:new Date().toISOString(),itemLimit:50,truncated:false,status:'live',note:'Fully completed deliveries in the selected period.'},
    });
  };
  try{
    const cookie=(await sealSession(new Request(origin),base,'bmc_stockroom_session=synthetic_dispatch_poll_session')).split(';')[0];
    const read=async()=>{
      const response=await worker.fetch(new Request(origin+'/api/dispatch-status?week='+weekStart,{headers:{Cookie:cookie}}),base);
      assert.equal(response.status,200);assert.match(response.headers.get('cache-control'),/no-store/);return response.json();
    };
    const first=await read();assert.equal(first.wholesale.completedClientCount,1);assert.equal(first.wholesale.done,3);
    assert.equal(first.wholesale.completedClients[0].name,'Synthetic cafe 0');
    assert.equal(Object.hasOwn(first.wholesale,'previousOrders'),false);
    assert.doesNotMatch(JSON.stringify(first),/PRIVATE_ADDRESS|PRIVATE_PHONE|synthetic-server-dispatch-read-token|clientId/);
    count=2;assert.equal((await read()).wholesale.completedClientCount,2);assert.equal(dispatchReads,2);
  }finally{globalThis.fetch=original;}
});
