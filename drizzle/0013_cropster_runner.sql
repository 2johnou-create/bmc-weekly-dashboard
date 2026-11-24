ALTER TABLE dashboard_source_jobs ADD COLUMN provider TEXT NOT NULL DEFAULT 'render' CHECK (provider IN ('render', 'pull'));
--> statement-breakpoint
ALTER TABLE dashboard_source_jobs ADD COLUMN claimed_at INTEGER;
