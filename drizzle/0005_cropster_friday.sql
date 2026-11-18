CREATE TABLE `dashboard_cropster_friday` (
	`week_start` text PRIMARY KEY NOT NULL,
	`roasted_kg` real,
	`roasted_value` real,
	`green_kg` real,
	`green_value` real,
	`production_read_at` integer,
	`green_read_at` integer
);
