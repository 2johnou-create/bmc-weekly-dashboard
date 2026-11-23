CREATE TABLE IF NOT EXISTS dashboard_source_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  public_id TEXT UNIQUE,
  week_start TEXT NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('warming', 'starting', 'reading', 'complete', 'failed')),
  reader_job_id TEXT,
  request_id TEXT NOT NULL,
  manual_request_id TEXT,
  started_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  next_attempt_at INTEGER NOT NULL DEFAULT 0,
  lease_owner TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  safe_code TEXT,
  summary_json TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS dashboard_source_jobs_active_week
  ON dashboard_source_jobs(week_start) WHERE phase IN ('warming', 'starting', 'reading');
CREATE INDEX IF NOT EXISTS dashboard_source_jobs_latest_week ON dashboard_source_jobs(week_start, started_at DESC);
CREATE INDEX IF NOT EXISTS dashboard_source_jobs_reader ON dashboard_source_jobs(reader_job_id);
