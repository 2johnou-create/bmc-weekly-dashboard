CREATE TABLE `dashboard_source_sync_log` (
	`id` text PRIMARY KEY NOT NULL,
	`week_start` text NOT NULL,
	`checked_at` integer NOT NULL,
	`status` text NOT NULL,
	`source_status_json` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_source_sync_checked` ON `dashboard_source_sync_log` (`checked_at`);