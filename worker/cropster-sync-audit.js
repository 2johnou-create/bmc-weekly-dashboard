import { dashboardWeek } from './metrics.js';

export const cropsterAuditTool = {
  name:'audit_dashboard_sync',
  description:'Read current-week dashboard source health and recent saved worker runs. Returns capture times, reconciliation, and source statuses without business figures. Owner only.',
  inputSchema:{type:'object',properties:{},additionalProperties:false},
  annotations:{readOnlyHint:true,destructiveHint:false,idempotentHint:true,openWorldHint:false},
};

export async function auditCropsterSync(db, now) {
  const {start}=dashboardWeek(undefined,now);
  const [jobs,production,schedule,stock,lab,tally,expenses]=await Promise.all([
    db.prepare(`SELECT id,phase,started_at,claimed_at,finished_at,safe_code
      FROM dashboard_source_jobs WHERE provider='pull' AND week_start=? ORDER BY started_at DESC LIMIT 8`).bind(start).all(),
    db.prepare('SELECT recorded_at FROM dashboard_cropster_readings WHERE week_start=?').bind(start).first(),
    db.prepare('SELECT recorded_at FROM dashboard_cropster_scheduled_batches WHERE week_start=?').bind(start).first(),
    db.prepare('SELECT recorded_at FROM dashboard_cropster_green_stock WHERE location=?').bind('Marrickville').first(),
    db.prepare('SELECT part, recorded_at FROM dashboard_roastery_lab_cropster').all(),
    db.prepare('SELECT modified_at,checked_at FROM dashboard_private_roast_tallies WHERE week_start=?').bind(start).first(),
    db.prepare('SELECT captured_at FROM warehouse_expense_readings WHERE week_start=?').bind(start).first(),
  ]);
  const at=value=>Number.isSafeInteger(value) && value>0 ? new Date(value).toISOString() : null;
  const observations={
    production:at(production?.recorded_at),schedule:at(schedule?.recorded_at),green:at(stock?.recorded_at),
    lab:Object.fromEntries(['inventory','recipes','use','loss'].map(part=>[part,at(lab.results.find(row=>row.part===part)?.recorded_at)])),
    tallyChecked:at(tally?.checked_at),tallyModified:at(tally?.modified_at),expenses:at(expenses?.captured_at),
  };
  return {
    weekStart:start,checkedAt:now.toISOString(),observations,
    productionAndScheduleMatch:observations.production!==null && observations.production===observations.schedule,
    runs:jobs.results.map(row=>({jobId:row.id,phase:row.phase,queuedAt:at(row.started_at),claimedAt:at(row.claimed_at),
      finishedAt:at(row.finished_at),safeCode:row.safe_code})),
  };
}
