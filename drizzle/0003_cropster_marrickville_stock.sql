CREATE TABLE `dashboard_cropster_green_stock` (
	`location` text PRIMARY KEY NOT NULL,
	`kg` real NOT NULL,
	`value` real,
	`recorded_at` integer NOT NULL,
	CONSTRAINT "dashboard_cropster_green_stock_marrickville" CHECK("dashboard_cropster_green_stock"."location" = 'Marrickville')
);
--> statement-breakpoint
CREATE TABLE `__new_dashboard_cropster_readings` (
	`week_start` text PRIMARY KEY NOT NULL,
	`roasted_kg` real NOT NULL,
	`scheduled_kg` real,
	`roasted_value` real,
	`scheduled_value` real,
	`previous_roasted_kg` real,
	`previous_scheduled_kg` real,
	`previous_roasted_value` real,
	`previous_scheduled_value` real,
	`green_kg` real,
	`green_value` real,
	`recorded_at` integer NOT NULL
);
--> statement-breakpoint
INSERT INTO `__new_dashboard_cropster_readings`("week_start", "roasted_kg", "scheduled_kg", "roasted_value", "scheduled_value", "previous_roasted_kg", "previous_scheduled_kg", "previous_roasted_value", "previous_scheduled_value", "green_kg", "green_value", "recorded_at") SELECT "week_start", "roasted_kg", "scheduled_kg", "roasted_value", "scheduled_value", "previous_roasted_kg", "previous_scheduled_kg", "previous_roasted_value", "previous_scheduled_value", "green_kg", "green_value", "recorded_at" FROM `dashboard_cropster_readings`;--> statement-breakpoint
DROP TABLE `dashboard_cropster_readings`;--> statement-breakpoint
ALTER TABLE `__new_dashboard_cropster_readings` RENAME TO `dashboard_cropster_readings`;--> statement-breakpoint
CREATE INDEX `dashboard_cropster_readings_recorded_idx` ON `dashboard_cropster_readings` (`recorded_at`,`week_start`);
