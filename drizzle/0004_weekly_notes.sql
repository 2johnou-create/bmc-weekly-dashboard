CREATE TABLE `dashboard_weekly_notes` (
	`week_start` text PRIMARY KEY NOT NULL,
	`lines_json` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL
);
