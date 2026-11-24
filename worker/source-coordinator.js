import { coordinateCropsterQueue, queueEnabled } from './cropster-queue.js';
import { dashboardWeek, addDays } from './metrics.js';
import { cropsterReaderConnection, requestCropsterWebsiteJob, ingestCropsterSync,
  readCurrentCropster, readSavedCropsterJob, validSyncJobId, safeReaderCode } from './cropster-reader.js';
import { readSourceSyncLog, saveSourceSyncLog, sourceSyncSummary } from './source-sync.js';

const ACTIVE = new Set(['warming', 'starting', 'reading']);
const FRESH_MS = 30 * 60_000;
const START_WINDOW_MS = 8 * 60_000;
const RUN_WINDOW_MS = 40 * 60_000;
const LEASE_MS = 45_000;
const SOFT_RETRY_MS = 10 * 60_000;
const HARD_RETRY_MS = 60 * 60_000;
const hardFailure = code => ['READER_CONFIGURATION', 'READER_HTTP_400', 'READER_HTTP_401', 'READER_HTTP_403', 'CROPSTER_AUTH_REQUIRED', 'CROPSTER_CONFIGURATION_REQUIRED'].includes(code);
const stateFailure = state => /^(?:READER|CROPSTER)_[A-Z0-9_]{1,60}$/.test(state?.error || '') ? state.error : 'READER_SOURCE_FAILED';
const object = value => value && typeof value === 'object' && !Array.isArray(value);

function sourceSummary(row) {
  try { const value = JSON.parse(row?.summary_json || 'null'); return object(value) && Array.isArray(value.sources) ? value : null; }
  catch { return null; }
}

function automaticHours(now) {
  const parts = new Intl.DateTimeFormat('en-AU', {timeZone:'Australia/Sydney', weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const weekday = parts.find(part => part.type === 'weekday')?.value;
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return ['Mon','Tue','Wed','Thu','Fri'].includes(weekday) && hour >= 6 && hour < 20;
}

async function automaticSourcesFresh(db, weekStart, time) {
  const [production,pending,green,monday,parts]=await Promise.all([
    db.prepare('SELECT recorded_at, previous_roasted_kg, previous_scheduled_kg, previous_roasted_value, previous_scheduled_value FROM dashboard_cropster_readings WHERE week_start = ?').bind(weekStart).first(),
    db.prepare('SELECT recorded_at FROM dashboard_cropster_scheduled_batches WHERE week_start = ?').bind(weekStart).first(),
    db.prepare('SELECT recorded_at FROM dashboard_cropster_green_stock WHERE location = ?').bind('Marrickville').first(),
    db.prepare('SELECT recorded_at FROM dashboard_cropster_monday WHERE week_start = ?').bind(weekStart).first(),
    db.prepare('SELECT part, recorded_at FROM dashboard_roastery_lab_cropster').all(),
  ]);
  const fresh=(row,maxAge) => Number.isFinite(row?.recorded_at) && row.recorded_at <= time+120_000 && time-row.recorded_at < maxAge;
  const lab=new Map((parts.results || []).map(row=>[row.part,row]));
  return fresh(production,FRESH_MS) && pending?.recorded_at === production.recorded_at && fresh(green,FRESH_MS) && fresh(monday,24*60*60_000)
    && ['previous_roasted_kg','previous_scheduled_kg','previous_roasted_value','previous_scheduled_value'].every(key=>Number.isFinite(production[key]))
    && ['inventory','recipes','use','loss'].every(part=>fresh(lab.get(part),24*60*60_000));
}

function phaseNote(row) {
  if (row.safe_code === 'READER_HTTP_429') return 'The Cropster reader connection is rate-limited. The dashboard will wait before trying again. Saved figures retain their capture times.';
  if (row.phase === 'warming') return 'Waking the free Cropster reader. Saved figures retain their capture times.';
  if (row.phase === 'starting') return 'Starting the Cropster website update. A repeated check reuses the same request.';
  if (row.phase === 'reading') return 'Cropster is updating in the background. Verified sections save as they finish.';
  if (row.phase === 'complete') return 'The Cropster update completed and remains saved with its actual capture times.';
  return 'The Cropster update could not finish (' + (row.safe_code || 'READER_UNAVAILABLE') + '). Verified saved figures retain their capture times.';
}

function metadata(row, publicId, now = new Date()) {
  return {status: ACTIVE.has(row.phase) ? 'running' : row.phase, jobId:publicId || row.public_id || row.reader_job_id || row.id,
    weekStart:row.week_start, phase:row.phase, note:phaseNote(row), retryAfterMs:Math.max(ACTIVE.has(row.phase) ? 5_000 : 0, row.next_attempt_at-now.getTime()),
    ...(row.safe_code ? {safeCode:row.safe_code} : {}), ...(sourceSummary(row) ? {sourceSync:sourceSummary(row)} : {})};
}

async function publicResult(db, row, requestedId = null, now = new Date()) {
  // Keep the first exposed UUID stable. A warm first request may expose the
  // Reader UUID for backwards compatibility; cold starts expose the durable ID.
  const candidate = row.public_id || requestedId || row.reader_job_id || row.id;
  if (!row.public_id) {
    await db.prepare('UPDATE dashboard_source_jobs SET public_id = ? WHERE id = ? AND public_id IS NULL').bind(candidate,row.id).run();
    row = await db.prepare('SELECT * FROM dashboard_source_jobs WHERE id = ?').bind(row.id).first();
  }
  return metadata(row, row.public_id, now);
}

export async function findDashboardSyncJob(env, jobId, weekStart) {
  if (!env.DB?.prepare || !validSyncJobId(jobId)) return null;
  const row = await env.DB.prepare('SELECT * FROM dashboard_source_jobs WHERE (id = ? OR public_id = ? OR reader_job_id = ?) AND week_start = ? ORDER BY started_at DESC LIMIT 1')
    .bind(jobId,jobId,jobId,weekStart).first();
  return row || null;
}

export async function readCoordinatedCropster({env, row, jobId = null, now = new Date()}) {
  let summary = sourceSummary(row);
  if (row.provider === 'pull' && !summary) summary = await readSourceSyncLog(env.DB,row.id,row.week_start);
  if (row.reader_job_id) summary = await readSourceSyncLog(env.DB,row.reader_job_id,row.week_start) || summary;
  if (row.phase === 'failed') summary={...summary,jobStatus:'failed',sources:summary?.sources || []};
  return readSavedCropsterJob({env,weekStart:row.week_start,followingWeekStart:addDays(row.week_start,7),now,
    jobId:jobId || row.public_id || row.id,summary,pending:ACTIVE.has(row.phase),phase:row.phase,safeCode:row.safe_code});
}

async function saveCoreState(env, row, state, now) {
  let readings;
  if (state.result) {
    readings = await ingestCropsterSync({env,weekStart:row.week_start,jobId:state.jobId,input:state.result,status:state.status,now});
    if (state.status === 'complete' && !readings.refresh.accepted) {
      const error = new Error('Verified source persistence was not confirmed.'); error.safeCode='READER_OBSERVATION_REJECTED'; throw error;
    }
  } else {
    readings = await readCurrentCropster({env,weekStart:row.week_start,followingWeekStart:addDays(row.week_start,7),now,fresh:false});
    readings.refresh = {...readings.refresh,status:state.status === 'running' ? 'pending' : 'failed',fetched:false,greenFetched:false};
  }
  const summary = sourceSyncSummary({weekly:{generatedAt:now.toISOString(),cropsterRefresh:readings.refresh,
    metrics:{production:readings.production,green:readings.green}},lab:{source:{},purchases:{},coffeeC:{}}});
  summary.sources = summary.sources.filter(source => ['production','monday','previous-production','green'].includes(source.id) || source.id.startsWith('lab-'));
  summary.jobStatus=state.status;
  summary.status=state.status === 'complete' && summary.sources.every(source => source.status === 'updated') ? 'complete' : 'partial';
  summary.message=state.status === 'complete' ? 'Verified Cropster sections saved. Other dashboard sources retain their own statuses.'
    : state.status === 'running' ? 'Verified Cropster sections saved. Remaining reports are updating in the background.'
    : 'The Cropster update stopped. Verified sections retain their actual capture times.';
  await saveSourceSyncLog(env.DB,state.jobId,row.week_start,summary,now);
  return summary;
}

// The callback has already verified the Reader and persisted its observation.
// Its durable terminal outcome outlives the Reader's short in-memory retention.
export async function acknowledgeDashboardSync({env,readerJobId,weekStart,status,summary,safeCode=null,now=new Date()}) {
  if (!validSyncJobId(readerJobId) || !['running','complete','failed'].includes(status) || !object(summary)) return;
  const phase=status === 'running' ? 'reading' : status;
  const failure=status === 'failed' ? stateFailure({error:safeCode}) : null;
  await env.DB.prepare(`UPDATE dashboard_source_jobs SET
    phase = CASE WHEN manual_request_id IS NOT NULL THEN 'reading' ELSE ? END, summary_json = ?, updated_at = ?,
    finished_at = CASE WHEN manual_request_id IS NOT NULL THEN NULL WHEN ? = 'reading' THEN finished_at ELSE ? END,
    lease_owner = NULL, lease_until = 0, safe_code = ?, next_attempt_at = CASE WHEN manual_request_id IS NOT NULL THEN 0 ELSE ? END
    WHERE reader_job_id = ? AND week_start = ? AND (phase IN ('warming','starting','reading') OR (? = 'complete' AND phase = 'failed'))`)
    .bind(phase,JSON.stringify(summary),now.getTime(),phase,now.getTime(),failure,
      status === 'failed' ? now.getTime()+(hardFailure(failure)?HARD_RETRY_MS:SOFT_RETRY_MS) : 0,
      readerJobId,weekStart,status).run();
}

async function advance(env, row, now, fetcher) {
  const db=env.DB, time=now.getTime(), wallStart=Date.now();
  if (!ACTIVE.has(row.phase) || row.next_attempt_at > time) return row;
  const owner=crypto.randomUUID();
  const leased=await db.prepare(`UPDATE dashboard_source_jobs SET lease_owner = ?, lease_until = ?
    WHERE id = ? AND phase IN ('warming','starting','reading') AND lease_until <= ? AND next_attempt_at <= ? RETURNING *`)
    .bind(owner,time+LEASE_MS,row.id,time,time).first();
  if (!leased) return await db.prepare('SELECT * FROM dashboard_source_jobs WHERE id = ?').bind(row.id).first();
  row=leased;
  let nextPhase=row.phase, readerId=row.reader_job_id, requestId=row.request_id, manualId=row.manual_request_id;
  let code=null, next=time+30_000, finished=null, summary=sourceSummary(row), attempts=row.attempts;
  try {
    const persisted=readerId ? await readSourceSyncLog(db,readerId,row.week_start) : null;
    if (!row.manual_request_id && ['complete','failed'].includes(persisted?.jobStatus)) {
      nextPhase=persisted.jobStatus;summary=persisted;finished=time;next=0;
    } else {
      // A 429 explicitly rejected the previous start. After its cooldown, try
      // the same key once, even if the next viewer arrived after the startup window.
      const rateLimitedStart = !readerId && row.safe_code === 'READER_HTTP_429';
      if (!rateLimitedStart && time-row.started_at > (readerId ? RUN_WINDOW_MS : START_WINDOW_MS)) {
        const error=new Error('Reader update deadline passed.');
        error.safeCode=row.safe_code || (readerId?'READER_RUN_TIMEOUT':'READER_WAKE_TIMEOUT');
        error.deadlinePassed=true;
        throw error;
      }
      if (!readerId) {
        nextPhase='starting';
        // requestId is persisted before the POST. Unknown transport outcomes
        // are retried with that same ID, never an unkeyed duplicate start.
        const state=await requestCropsterWebsiteJob({env,weekStart:row.week_start,requestId,fetcher});
        readerId=state.jobId;nextPhase=state.status === 'running'?'reading':state.status;
        if (state.result || state.status !== 'running') summary=await saveCoreState(env,{...row,reader_job_id:readerId},state,now);
        if (state.status !== 'running') {finished=time;code=state.status === 'failed'?stateFailure(state):null;next=code?time+(hardFailure(code)?HARD_RETRY_MS:SOFT_RETRY_MS):0;}
      } else {
        let state;
        if (manualId) {
          state=await requestCropsterWebsiteJob({env,weekStart:row.week_start,requestId:manualId,fetcher});
          readerId=state.jobId;manualId=null;
        } else state=await requestCropsterWebsiteJob({env,weekStart:row.week_start,jobId:readerId,fetcher});
        nextPhase=state.status === 'running'?'reading':state.status;
        if (state.result || state.status !== 'running') summary=await saveCoreState(env,{...row,reader_job_id:readerId},state,now);
        if (state.status !== 'running') {finished=time;code=state.status === 'failed'?stateFailure(state):null;next=code?time+(hardFailure(code)?HARD_RETRY_MS:SOFT_RETRY_MS):0;}
      }
    }
  } catch (error) {
    code=safeReaderCode(error);attempts++;
    const terminal=error.deadlinePassed || hardFailure(code) || ['READER_JOB_EXPIRED','READER_OBSERVATION_REJECTED','READER_RUN_TIMEOUT','READER_WAKE_TIMEOUT'].includes(code)
      || (!readerId && time-row.started_at >= START_WINDOW_MS);
    const receivedAt=time+Math.max(0,Date.now()-wallStart);
    const throttleDelay=code==='READER_HTTP_429' ? Math.min(240_000,30_000 * 2 ** Math.min(attempts-1,3)) : 0;
    const retryDelay=Math.max(error.retryAfterMs || 0, throttleDelay);
    if (terminal) {
      nextPhase='failed';finished=receivedAt;
      next=receivedAt+Math.max(hardFailure(code)?HARD_RETRY_MS:SOFT_RETRY_MS,retryDelay);
    } else {
      nextPhase=readerId?'reading':'starting';
      next=receivedAt+Math.max(retryDelay,Math.min(15_000,5_000*attempts));
    }
  }
  // A verified callback may have completed the job while this network read ran.
  const pendingManual="manual_request_id IS NOT NULL AND manual_request_id IS NOT ?";
  await db.prepare(`UPDATE dashboard_source_jobs SET
    phase = CASE WHEN ${pendingManual} THEN 'reading' ELSE ? END, reader_job_id = ?,
    manual_request_id = CASE WHEN manual_request_id IS ? THEN ? ELSE manual_request_id END,
    updated_at = ?, finished_at = CASE WHEN ${pendingManual} THEN NULL ELSE ? END,
    next_attempt_at = CASE WHEN ${pendingManual} AND ? IS NOT 'READER_HTTP_429' AND ? IS NOT 'READER_HTTP_503' THEN 0 ELSE ? END, attempts = ?, safe_code = ?, summary_json = ?,
    lease_owner = NULL, lease_until = 0 WHERE id = ? AND lease_owner = ? AND phase IN ('warming','starting','reading')`)
    .bind(row.manual_request_id,nextPhase,readerId,row.manual_request_id,manualId,time,row.manual_request_id,finished,row.manual_request_id,code,code,next,
      attempts,code,summary?JSON.stringify(summary):null,row.id,owner).run();
  return await db.prepare('SELECT * FROM dashboard_source_jobs WHERE id = ?').bind(row.id).first();
}

export async function coordinateDashboardSync({env,weekStart,jobId=null,mode='auto',now=new Date(),fetcher=fetch}) {
  if (queueEnabled(env)) return coordinateCropsterQueue({env,weekStart,jobId,mode,now});
  const week=dashboardWeek(weekStart,now), time=now.getTime();
  if (!week.isCurrent) return {status:'archive',weekStart:week.start,phase:'saved',note:'Historical Friday archives are retained.'};
  if (!['auto','manual'].includes(mode) || jobId !== null && !validSyncJobId(jobId)) throw new Error('Invalid source sync request.');
  const config=cropsterReaderConnection(env);
  if (!config.configured) return {status:'not-connected',weekStart:week.start,note:'The Cropster website reader is not connected.'};
  if (!config.valid) return {status:'failed',weekStart:week.start,phase:'failed',safeCode:'READER_CONFIGURATION',note:'The Cropster reader connection needs configuration.'};
  if (!env.DB?.prepare) throw new Error('Source sync storage is unavailable.');
  const db=env.DB;
  let row=jobId ? await findDashboardSyncJob(env,jobId,week.start) : await db.prepare(`SELECT * FROM dashboard_source_jobs
    WHERE week_start = ? ORDER BY CASE WHEN phase IN ('warming','starting','reading') THEN 0 ELSE 1 END, started_at DESC LIMIT 1`).bind(week.start).first();
  if (jobId && !row) return null; // Compatibility with pre-coordinator Reader UUIDs.
  if (!jobId && row?.phase === 'failed' && ['READER_HTTP_429','READER_HTTP_503'].includes(row.safe_code) && row.next_attempt_at > time) return publicResult(db,row,null,now);
  if (!jobId && row && ACTIVE.has(row.phase) && mode === 'manual' && row.reader_job_id) {
    await db.prepare(`UPDATE dashboard_source_jobs SET manual_request_id = COALESCE(manual_request_id, ?),
      next_attempt_at = CASE WHEN safe_code IN ('READER_HTTP_429','READER_HTTP_503') THEN next_attempt_at ELSE 0 END
      WHERE id = ? AND phase = 'reading'`).bind(crypto.randomUUID(),row.id).run();
    row=await db.prepare('SELECT * FROM dashboard_source_jobs WHERE id = ?').bind(row.id).first();
  }
  if (jobId || row && ACTIVE.has(row.phase)) return publicResult(db,await advance(env,row,now,fetcher),jobId,now);
  if (mode === 'auto') {
    if (row?.phase === 'failed' && row.next_attempt_at > time) return publicResult(db,row,null,now);
    if (await automaticSourcesFresh(db,week.start,time) || row?.phase === 'complete' && time-(row.finished_at || row.started_at) < SOFT_RETRY_MS) {
      return {status:'complete',weekStart:week.start,phase:'saved',note:'Saved Cropster readings retain their capture times. The next automatic check is due after the refresh interval.',
        ...(sourceSummary(row)?{sourceSync:sourceSummary(row)}:{})};
    }
    if (!automaticHours(now)) return {status:'complete',weekStart:week.start,phase:'outside-hours',note:'Automatic Cropster reads run on Sydney weekdays from 6 am to 8 pm. Manual Refresh is available anytime.'};
  }
  const id=crypto.randomUUID();
  await db.prepare(`INSERT INTO dashboard_source_jobs (id,week_start,phase,request_id,started_at,updated_at)
    VALUES (?,?,'warming',?,?,?) ON CONFLICT DO NOTHING`).bind(id,week.start,crypto.randomUUID(),time,time).run();
  row=await db.prepare(`SELECT * FROM dashboard_source_jobs WHERE week_start = ? AND phase IN ('warming','starting','reading') ORDER BY started_at DESC LIMIT 1`).bind(week.start).first();
  if (!row) throw new Error('A source update could not be registered.');
  return publicResult(db,await advance(env,row,now,fetcher),null,now);
}
