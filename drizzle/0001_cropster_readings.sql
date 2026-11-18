CREATE TABLE `dashboard_cropster_readings` (
	`week_start` text PRIMARY KEY NOT NULL,
	`roasted_kg` real NOT NULL,
	`scheduled_kg` real,
	`roasted_value` real,
	`scheduled_value` real,
	`previous_roasted_kg` real,
	`previous_scheduled_kg` real,
	`previous_roasted_value` real,
	`previous_scheduled_value` real,
	`green_kg` real NOT NULL,
	`green_value` real,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `dashboard_cropster_readings_recorded_idx` ON `dashboard_cropster_readings` (`recorded_at`,`week_start`);