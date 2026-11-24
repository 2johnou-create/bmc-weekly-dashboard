import assert from 'node:assert/strict';
import test from 'node:test';
import {localDatabase} from '../scripts/local-db.mjs';
import {claimCropsterRun,coordinateCropsterQueue,renewCropsterRun} from '../worker/cropster-queue.js';

test('an interrupted runner releases the week for a new claim without accepting stale writes',async()=>{
  const DB=localDatabase(':memory:');
  const env={DB};
  const now=new Date('2026-11-25T00:00:00.000Z');
  const elapsed=minutes=>new Date(now.getTime()+minutes*60000);
  try {
    const firstRunner=crypto.randomUUID(),nextRunner=crypto.randomUUID();
    const job=await claimCropsterRun(env,firstRunner,now);
    assert.ok(job.jobId);
    assert.equal(await claimCropsterRun(env,nextRunner,elapsed(1)),null);
    assert.ok(await renewCropsterRun(DB,job.jobId,firstRunner,elapsed(4)));
    const replacement=await claimCropsterRun(env,nextRunner,elapsed(10));
    assert.notEqual(replacement.jobId,job.jobId);
    assert.equal(await renewCropsterRun(DB,job.jobId,firstRunner,elapsed(10)),null);
    const status=await coordinateCropsterQueue({env,jobId:job.jobId,now:elapsed(10)});
    assert.equal(status.status,'failed');assert.equal(status.safeCode,'RUNNER_LEASE_EXPIRED');
  } finally {DB.close();}
});
