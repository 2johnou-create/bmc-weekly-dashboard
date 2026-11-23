import assert from 'node:assert/strict';
import test from 'node:test';
import {handleDashboardMcp} from '../worker/background-mcp.js';

const now = new Date('2026-11-23T00:00:00Z');
const jobId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const make = (method, params, owner, id = 1) => new Request('https://dashboard.test/mcp', {method:'POST',headers:{'Content-Type':'application/json',...(owner ? {'oai-authenticated-user-email':owner} : {})},body:JSON.stringify({jsonrpc:'2.0',id,method,params})});

test('background source tools disclose only tool metadata until the trusted Sites owner identity is present', async () => {
  const coordinate = () => assert.fail('Other viewers must never start the source reader');
  const listed = await handleDashboardMcp(make('tools/list'),{}, {coordinate,now});
  assert.deepEqual((await listed.json()).result.tools.map(tool=>tool.name),['refresh_dashboard_sources','check_dashboard_sync']);
  for (const owner of [undefined,'someone@example.com']) {
    const reply = await handleDashboardMcp(make('tools/call',{name:'refresh_dashboard_sources',arguments:{}},owner),{}, {coordinate,now});
    assert.equal(reply.status,403);
  }
});

test('owner background calls share the current-week coordinator and strip unexpected business fields', async () => {
  const calls=[];
  const coordinate = async args => {calls.push(args); return {status:'running',jobId,weekStart:'2026-11-23',phase:'waking',note:'Waking Cropster reader.',retryAfterMs:180000,production:{roastedKg:123},token:'PRIVATE_FIXTURE'};};
  const reply=await handleDashboardMcp(make('tools/call',{name:'refresh_dashboard_sources',arguments:{}},'2johnou@gmail.com'),{sample:true},{coordinate,now});
  const value=await reply.json();
  assert.equal(calls.length,1);
  assert.equal(calls[0].mode,'auto');
  assert.equal(calls[0].weekStart,'2026-11-23');
  assert.equal(value.result.structuredContent.jobId,jobId);
  assert.equal(value.result.structuredContent.retryAfterMs,180000);
  assert.doesNotMatch(JSON.stringify(value),/roastedKg|PRIVATE_FIXTURE|production/);
});

test('status calls retain the durable job reference while malformed, future and excessive arguments cannot start work', async () => {
  const calls=[];
  const coordinate=async args=>{calls.push(args);return {status:'complete',jobId,weekStart:'2026-11-23'};};
  const params={name:'check_dashboard_sync',arguments:{jobId,weekStart:'2026-11-23'}};
  const checked=await handleDashboardMcp(make('tools/call',params,'2johnou@gmail.com'),{}, {coordinate,now});
  assert.equal((await checked.json()).result.structuredContent.status,'complete');
  assert.equal(calls[0].jobId,jobId);
  for (const arguments2 of [{jobId:'wrong'},{jobId,weekStart:'2026-11-24'},{jobId,weekStart:'2026-11-30'},{jobId,secret:'no'}]) {
    const reply=await handleDashboardMcp(make('tools/call',{name:'check_dashboard_sync',arguments:arguments2},'2johnou@gmail.com'),{}, {coordinate,now});
    assert.ok((await reply.json()).error);
  }
  assert.equal(calls.length,1);
});

test('background failures remain safe and never expose raw source URLs or private diagnostics', async () => {
  const coordinate=async()=>{throw new Error('PRIVATE_SOURCE_TOKEN');};
  const reply=await handleDashboardMcp(make('tools/call',{name:'refresh_dashboard_sources'},'2johnou@gmail.com'),{}, {coordinate,now});
  const value=await reply.json();
  assert.equal(value.result.isError,true);
  assert.doesNotMatch(JSON.stringify(value),/PRIVATE_SOURCE_TOKEN/);
});
