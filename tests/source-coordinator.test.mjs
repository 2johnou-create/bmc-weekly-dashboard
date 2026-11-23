import test from 'node:test';
import assert from 'node:assert/strict';
import {localDatabase} from '../scripts/local-db.mjs';
import {coordinateDashboardSync,findDashboardSyncJob,readCoordinatedCropster,acknowledgeDashboardSync} from '../worker/source-coordinator.js';
import {readCurrentCropster} from '../worker/cropster-reader.js';
import {saveSourceSyncLog} from '../worker/source-sync.js';
import {saveCropsterReading,saveCropsterGreenStock} from '../worker/cropster.js';

const weekStart='2026-11-23';
const start=Date.parse('2026-11-22T23:00:00Z'); // Monday10amSydney.
const readerId='11111111-2222-4333-8444-555555555555';
const readerToken='synthetic-coordinator-reader-token-12345678901234567890';
const envFor=DB=>({DB,CROPSTER_READER_URL:'https://synthetic-reader.onrender.com',CROPSTER_READER_TOKEN:readerToken});
const clock=offset=>new Date(start+offset);
function observation(now) {return {
  schemaVersion:'1.0',sourceSystem:'cropster-website',location:'Marrickville',weekStart,periodEnd:'2026-11-27',observedAt:now.toISOString(),
  productionObservedAt:now.toISOString(),greenObservedAt:now.toISOString(),mondayObservedAt:now.toISOString(),
  production:{roastedKg:120,scheduledKg:50,roastedValue:1200,scheduledValue:600},
  scheduledBatches:{greenKg:60,batches:2},green:{location:'Marrickville',kg:1000,value:10000},mondayRoastedKg:120,
};}
function fakeReader(options={}) {
  const state={health:0,posts:[],polls:0,status:'running',now:clock(0),jobs:new Map(),logicalStarts:0};
  const fetcher=async (address,init={})=>{
    const url=new URL(address);
    assert.equal(url.origin,'https://synthetic-reader.onrender.com');assert.equal(init.redirect,'manual');
    if(url.pathname==='/health') {
      state.health++;assert.equal(init.headers.Authorization,undefined);
      if(options.health) return options.health(state);
      return Response.json({status:'ok',service:'cropster-website-reader'});
    }
    assert.equal(init.headers.Authorization,'Bearer '+readerToken);
    if(init.method==='POST') {
      assert.equal(url.pathname,'/v1/sync');const body=JSON.parse(init.body);assert.equal(body.weekStart,weekStart);
      assert.match(body.requestId,/^[0-9a-f-]{36}$/);state.posts.push(body.requestId);
      if(options.startStatus) return Response.json({error:{code:'UNAUTHORISED'}},{status:options.startStatus});
      if(!state.jobs.has(body.requestId)) {state.jobs.set(body.requestId,readerId);state.logicalStarts++;}
      if(options.post) {const custom=await options.post(state,body);if(custom)return custom;}
      return Response.json({schemaVersion:'1.0',status:'running',jobId:readerId,weekStart},{status:202});
    }
    state.polls++;
    if(options.poll) return options.poll(state);
    return Response.json({schemaVersion:'1.0',status:state.status,jobId:readerId,weekStart,
      ...(state.status==='complete'?{result:observation(state.now)}:{})});
  };
  return {state,fetcher};
}
async function setup(action) {const db=localDatabase(':memory:');try{await action({db,env:envFor(db)});}finally{db.close();}}

test('a cold start posts the durable job directly and honors the upstream retry interval across viewers',async()=>setup(async({db,env})=>{
  const {state,fetcher}=fakeReader({post:state=>state.posts.length===1
    ? new Response(null,{status:429,headers:{'Retry-After':'180'}}) : null});
  const first=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});
  assert.equal(first.status,'running');assert.equal(first.phase,'starting');assert.equal(first.safeCode,'READER_HTTP_429');
  assert.ok(first.retryAfterMs>=180_000);
  for (const args of [{jobId:first.jobId},{mode:'auto'},{mode:'manual'}]) {
    const waiting=await coordinateDashboardSync({env,weekStart,...args,now:clock(179_000),fetcher});
    assert.equal(waiting.jobId,first.jobId);
  }
  assert.equal(state.posts.length,1);assert.equal(state.health,0);
  const awake=await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(181_000),fetcher});
  assert.equal(awake.phase,'reading');assert.equal(awake.jobId,first.jobId);assert.equal(awake.retryAfterMs,30000);
  assert.deepEqual(state.posts,[state.posts[0],state.posts[0]]);
  assert.equal((await db.prepare('SELECT id FROM dashboard_source_jobs').all()).results.length,1);
}));

test('a cold-start deadline preserves the throttling reason and manual refresh honors cooldown',async()=>setup(async({env})=>{
  const {state,fetcher}=fakeReader({startStatus:429});
  const first=await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(0),fetcher});
  assert.ok(first.retryAfterMs>=30_000);
  const ended=await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(9*60_000),fetcher});
  assert.equal(ended.status,'failed');assert.equal(ended.safeCode,'READER_HTTP_429');
  const manual=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(10*60_000),fetcher});
  assert.equal(manual.jobId,ended.jobId);assert.equal(state.posts.length,1);
}));

test('several viewers join one atomic week lease instead of starting duplicate jobs',async()=>setup(async({db,env})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {state,fetcher}=fakeReader({post:async()=>{await gate;}});
  const first=coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(0),fetcher});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(state.posts.length,1);
  const joined=await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(0),fetcher});
  assert.equal(joined.status,'running');assert.equal(state.health,0);assert.equal(state.posts.length,1);
  release();const ready=await first;
  assert.equal(ready.jobId,joined.jobId);assert.equal(state.posts.length,1);
  assert.equal((await db.prepare('SELECT id FROM dashboard_source_jobs').all()).results.length,1);
}));

test('a lost startup response retries the persisted request ID, without a duplicate logical start',async()=>setup(async({env})=>{
  const {state,fetcher}=fakeReader({post:state=>{if(state.posts.length===1)throw new Error('PRIVATE_NETWORK_URL_AND_HEADERS');}});
  const uncertain=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});
  assert.equal(uncertain.phase,'starting');assert.equal(uncertain.status,'running');
  const retried=await coordinateDashboardSync({env,weekStart,jobId:uncertain.jobId,now:clock(6000),fetcher});
  assert.equal(retried.status,'running');assert.equal(retried.phase,'reading');
  assert.equal(state.posts.length,2);assert.equal(state.posts[0],state.posts[1]);assert.equal(state.logicalStarts,1);
  assert.doesNotMatch(JSON.stringify(retried),/PRIVATE_NETWORK|synthetic-coordinator-reader-token/);
}));

test('automatic joins only poll, while an explicit manual refresh requests a coalesced priority reread',async()=>setup(async({env})=>{
  const {state,fetcher}=fakeReader();
  const first=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});
  await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(31000),fetcher});
  assert.equal(state.posts.length,1);assert.equal(state.polls,1);
  await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(33000),fetcher});
  assert.equal(state.posts.length,2);assert.notEqual(state.posts[0],state.posts[1]);
  const row=await findDashboardSyncJob(env,first.jobId,weekStart);assert.equal(row.manual_request_id,null);
}));

test('a manual request arriving during a reader poll is retained rather than overwritten by that poll',async()=>setup(async({env})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});
  const {state,fetcher}=fakeReader({poll:async()=>{await gate;return Response.json({schemaVersion:'1.0',status:'running',jobId:readerId,weekStart});}});
  const first=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});
  const polling=coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(31000),fetcher});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(state.polls,1);
  await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(32000),fetcher});
  release();await polling;
  const row=await findDashboardSyncJob(env,first.jobId,weekStart);assert.match(row.manual_request_id,/^[0-9a-f-]{36}$/);
  await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(37000),fetcher});assert.equal(state.posts.length,2);
}));

test('a manual request racing completion remains active and consumes its keyed successor',async()=>setup(async({env})=>{
  let release;const gate=new Promise(resolve=>{release=resolve;});const nextReader=crypto.randomUUID();
  const {state,fetcher}=fakeReader({poll:async state=>{await gate;return Response.json({schemaVersion:'1.0',status:'complete',jobId:readerId,weekStart,result:observation(state.now)});},
    post:state=>state.posts.length>1?Response.json({schemaVersion:'1.0',status:'running',jobId:nextReader,weekStart},{status:202}):null});
  const first=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});state.now=clock(31000);
  const polling=coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(31000),fetcher});
  await new Promise(resolve=>setImmediate(resolve));assert.equal(state.polls,1);
  await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(32000),fetcher});release();
  const result=await polling;assert.equal(result.status,'running');
  const before=await findDashboardSyncJob(env,first.jobId,weekStart);assert.equal(before.phase,'reading');assert.ok(before.manual_request_id);
  const successor=await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(37000),fetcher});
  assert.equal(successor.status,'running');assert.equal(successor.jobId,first.jobId);assert.equal(state.posts.length,2);
  const after=await findDashboardSyncJob(env,first.jobId,weekStart);assert.equal(after.reader_job_id,nextReader);assert.equal(after.manual_request_id,null);
}));

test('verified completion survives reader expiry without requiring visitor-only Stock Take in its summary',async()=>setup(async({db,env})=>{
  const {state,fetcher}=fakeReader();
  const first=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});
  state.status='complete';state.now=clock(31000);
  const done=await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(31000),fetcher});
  assert.equal(done.status,'complete');assert.ok(done.sourceSync.sources.every(source=>source.id!=='stocktake'));
  const calls=state.polls;
  const expired=await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(20*60_000),fetcher:()=>assert.fail('A durable completion must not ask an expired Reader job')});
  assert.equal(expired.status,'complete');assert.equal(state.polls,calls);
  const readings=await readCurrentCropster({env,weekStart,followingWeekStart:'2026-11-30',jobId:readerId,fresh:true,now:clock(20*60_000),fetcher:()=>assert.fail('Stored terminal status must survive TTL')});
  assert.equal(readings.refresh.status,'refreshed');assert.equal(readings.production.roastedKg,120);assert.equal(readings.production.scheduledGreenKg,60);
  assert.equal(readings.production.asOf,clock(31000).toISOString());
  assert.equal((await db.prepare('SELECT recorded_at FROM dashboard_cropster_scheduled_batches').first()).recorded_at,start+31000);
}));

test('hard authorization failures expose only safe codes and automatic checks honor cooldown',async()=>setup(async({env})=>{
  const {state,fetcher}=fakeReader({startStatus:401});
  const denied=await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(0),fetcher});
  assert.equal(denied.status,'failed');assert.equal(denied.safeCode,'READER_HTTP_401');
  const retained=await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(30*60_000),fetcher});
  assert.equal(retained.status,'failed');assert.equal(state.posts.length,1);assert.equal(state.health,0);
}));

test('new-week freshness requires current-week production and matching raw schedule, while fresh sections avoid waking the reader',async()=>setup(async({db,env})=>{
  const {state,fetcher}=fakeReader();
  await saveCropsterReading(db,{weekStart,roastedKg:120,scheduledKg:50,roastedValue:1200,scheduledValue:600,
    previousRoastedKg:100,previousScheduledKg:0,previousRoastedValue:1000,previousScheduledValue:0},weekStart,clock(-60_000));
  await saveCropsterGreenStock(db,{kg:1000,value:10000},clock(-60_000));
  await db.prepare('INSERT INTO dashboard_cropster_scheduled_batches VALUES (?,?,?,?)').bind(weekStart,60,2,start-60_000).run();
  await db.prepare('INSERT INTO dashboard_cropster_monday VALUES (?,?,?)').bind(weekStart,120,start-60_000).run();
  for(const part of ['inventory','recipes','use','loss']) await db.prepare('INSERT INTO dashboard_roastery_lab_cropster VALUES (?,?,?)').bind(part,'{}',start-60_000).run();
  const saved=await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(0),fetcher});
  assert.equal(saved.phase,'saved');assert.equal(saved.jobId,undefined);assert.equal(state.health,0);
  await db.prepare('DELETE FROM dashboard_cropster_scheduled_batches').run();
  const missing=await coordinateDashboardSync({env,weekStart,mode:'auto',now:clock(1000),fetcher});
  assert.equal(missing.status,'running');assert.equal(state.posts.length,1);
}));

test('late verified completion can supersede a lost-job failure, but failed callbacks never downgrade complete',async()=>setup(async({env})=>{
  const {fetcher}=fakeReader({poll:()=>Response.json({error:{code:'JOB_NOT_FOUND'}},{status:404})});
  const first=await coordinateDashboardSync({env,weekStart,mode:'manual',now:clock(0),fetcher});
  const lost=await coordinateDashboardSync({env,weekStart,jobId:first.jobId,now:clock(31000),fetcher});assert.equal(lost.status,'failed');
  const summary={status:'partial',jobStatus:'complete',sources:[],message:'Verified completion saved.'};
  await saveSourceSyncLog(env.DB,readerId,weekStart,summary,clock(33000));
  await acknowledgeDashboardSync({env,readerJobId:readerId,weekStart,status:'complete',summary,now:clock(33000)});
  await acknowledgeDashboardSync({env,readerJobId:readerId,weekStart,status:'failed',summary:{...summary,jobStatus:'failed'},now:clock(34000)});
  const row=await findDashboardSyncJob(env,first.jobId,weekStart);assert.equal(row.phase,'complete');
  assert.equal((await readCoordinatedCropster({env,row,now:clock(35000)})).refresh.status,'refreshed');
}));
