import { dashboardWeek } from './metrics.js';
import { validSyncJobId } from './cropster-reader.js';

const interval = 55 * 60_000;
const maxQueueAge = 60 * 60_000;
const leaseTime = 5 * 60_000;
const maxRunTime = 35 * 60_000;
const active = new Set(['warming', 'reading']);
const codePattern = /^(?:CROPSTER|RUNNER|READER)_[A-Z0-9_]{1,60}$/;
const available = env => typeof env.CROPSTER_RUNNER_TOKEN === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(env.CROPSTER_RUNNER_TOKEN);
export const queueEnabled = env => env.CROPSTER_RUNNER_ENABLED === 'true' && available(env);

function businessHours(now) {
  const parts = new Intl.DateTimeFormat('en-AU', {timeZone:'Australia/Sydney',weekday:'short',hour:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const day = parts.find(part => part.type === 'weekday')?.value;
  const hour = Number(parts.find(part => part.type === 'hour')?.value);
  return day !== 'Sat' && day !== 'Sun' && hour >= 6 && hour < 20;
}

function view(row, now) {
  const running = active.has(row.phase);
  let sourceSync;
  try { sourceSync = JSON.parse(row.summary_json); } catch {}
  return {
    status:running ? 'running' : row.phase, phase:row.phase, jobId:row.id, weekStart:row.week_start,
    retryAfterMs:running ? 30_000 : Math.max(0,row.next_attempt_at-now),
    ...(row.safe_code ? {safeCode:row.safe_code} : {}),
    ...(sourceSync ? {sourceSync} : {}),
    note:row.phase === 'warming' ? 'Cropster refresh queued. The next scheduled worker will collect it.'
      : row.phase === 'reading' ? 'The worker is reading Cropster. Verified sections save as they finish.'
      : row.phase === 'complete' ? 'Cropster finished. The saved figures retain their capture times.'
      : 'Cropster could not update (' + row.safe_code + '). The dashboard shows the last verified readings.',
  };
}

export async function findQueuedRun(db, id, weekStart) {
  if (!validSyncJobId(id)) return null;
  return db.prepare("SELECT * FROM dashboard_source_jobs WHERE provider = 'pull' AND id = ? AND week_start = ?")
    .bind(id,weekStart).first();
}

async function expireRuns(db, time) {
  // A cancelled or disconnected runner can never hold the current week indefinitely.
  await db.prepare(`UPDATE dashboard_source_jobs SET phase='failed',safe_code='RUNNER_QUEUE_EXPIRED',finished_at=?,updated_at=?
    WHERE provider='pull' AND phase='warming' AND started_at < ?`).bind(time,time,time-maxQueueAge).run();
  await db.prepare(`UPDATE dashboard_source_jobs SET phase='failed',safe_code='RUNNER_LEASE_EXPIRED',finished_at=?,updated_at=?,
    lease_owner=NULL, lease_until=0 WHERE provider='pull' AND phase='reading' AND (lease_until <= ? OR claimed_at <= ?)`)
    .bind(time,time,time,time-maxRunTime).run();
}

export async function coordinateCropsterQueue({env,weekStart,jobId=null,mode='auto',now=new Date()}) {
  const week=dashboardWeek(weekStart,now), time=now.getTime(), db=env.DB;
  if (!week.isCurrent) return {status:'archive',phase:'saved',weekStart:week.start,note:'Historical Friday archives are retained.'};
  await expireRuns(db,time);
  if (jobId) {
    const row=await findQueuedRun(db,jobId,week.start);
    return row ? view(row,time) : {status:'complete',phase:'saved',weekStart:week.start,note:'The previous update reference has expired. Saved readings retain their capture times.'};
  }
  const latest=await db.prepare(`SELECT * FROM dashboard_source_jobs WHERE provider='pull' AND week_start=?
    ORDER BY CASE WHEN phase IN ('warming','reading') THEN 0 ELSE 1 END, started_at DESC LIMIT 1`).bind(week.start).first();
  if (latest && active.has(latest.phase)) {
    if (mode==='manual' && latest.phase==='reading') {
      await db.prepare(`UPDATE dashboard_source_jobs SET manual_request_id=? WHERE provider='pull' AND id=? AND phase='reading'
        AND EXISTS (SELECT 1 FROM dashboard_cropster_readings WHERE week_start=? AND recorded_at>=claimed_at AND recorded_at<?)`)
        .bind(crypto.randomUUID(),latest.id,week.start,time).run();
    }
    return view(latest,time);
  }
  if (mode==='auto') {
    if (latest?.phase==='failed' && latest.next_attempt_at>time) return view(latest,time);
    if (!businessHours(now)) return {status:'complete',phase:'outside-hours',weekStart:week.start,note:'Automatic Cropster reads run during Sydney weekday business hours.'};
    if (latest?.phase==='complete' && time-latest.claimed_at < interval) return view(latest,time);
  }
  // Migration can leave a legacy job active. Retire just that job when the pull
  // worker is enabled. Its verified snapshots remain in the reporting tables.
  await db.prepare(`UPDATE dashboard_source_jobs SET phase='failed',safe_code='RUNNER_MIGRATED',finished_at=?,updated_at=?
    WHERE provider='render' AND week_start=? AND phase IN ('warming','starting','reading')`).bind(time,time,week.start).run();
  await db.prepare(`INSERT INTO dashboard_source_jobs (id,week_start,phase,request_id,started_at,updated_at,provider)
    VALUES (?,?,'warming',?,?,?,'pull') ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),week.start,crypto.randomUUID(),time,time).run();
  const row=await db.prepare(`SELECT * FROM dashboard_source_jobs WHERE provider='pull' AND week_start=?
    AND phase IN ('warming','reading')`).bind(week.start).first();
  return row ? view(row,time) : {status:'complete',phase:'saved',weekStart:week.start,note:'Saved readings retain their capture times.'};
}

export async function claimCropsterRun(env, runnerId, now, force = false) {
  const {start}=dashboardWeek(undefined,now), time=now.getTime();
  let row=await env.DB.prepare(`SELECT id,week_start FROM dashboard_source_jobs
    WHERE provider='pull' AND week_start=? AND phase='reading' AND lease_owner=? AND lease_until>?`).bind(start,runnerId,time).first();
  if (row) return {jobId:row.id,weekStart:row.week_start};
  await coordinateCropsterQueue({env,now,mode:force ? 'manual' : 'auto'});
  row=await env.DB.prepare(`UPDATE dashboard_source_jobs SET phase='reading',claimed_at=?,updated_at=?,lease_owner=?,lease_until=?
    WHERE provider='pull' AND week_start=? AND phase='warming' RETURNING id,week_start`)
    .bind(time,time,runnerId,time+leaseTime,start).first();
  return row ? {jobId:row.id,weekStart:row.week_start} : null;
}

export async function renewCropsterRun(db, id, runnerId, now) {
  const time=now.getTime();
  const {start}=dashboardWeek(undefined,now);
  return db.prepare(`UPDATE dashboard_source_jobs SET lease_until=?,updated_at=?
    WHERE provider='pull' AND week_start=? AND id=? AND phase='reading' AND lease_owner=? AND lease_until>? AND claimed_at>?
    RETURNING id,week_start,claimed_at`).bind(time+leaseTime,time,start,id,runnerId,time,time-maxRunTime).first();
}

export async function finishCropsterRun(db, jobId, runnerId, status, summary, code, now) {
  const time=now.getTime();
  const safe = status === 'failed' ? (codePattern.test(code || '') ? code : 'RUNNER_CAPTURE_FAILED') : null;
  const row=await db.prepare(`UPDATE dashboard_source_jobs SET phase=?,summary_json=?,safe_code=?,finished_at=?,updated_at=?,
    lease_owner=NULL,lease_until=0,next_attempt_at=? WHERE provider='pull' AND id=? AND phase='reading' AND lease_owner=? AND lease_until>?
    RETURNING week_start,manual_request_id`)
    .bind(status,JSON.stringify(summary),safe,time,time,safe ? time+10*60_000 : 0,jobId,runnerId,time).first();
  if (row?.manual_request_id && status==='complete') {
    await db.prepare(`INSERT INTO dashboard_source_jobs (id,week_start,phase,request_id,started_at,updated_at,provider)
      VALUES (?,?,'warming',?,?,?,'pull') ON CONFLICT DO NOTHING`).bind(crypto.randomUUID(),row.week_start,row.manual_request_id,time,time).run();
  }
  return Boolean(row);
}
