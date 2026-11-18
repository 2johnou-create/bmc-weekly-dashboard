CREATE TABLE `dashboard_roastery_lab_cropster` (
	`part` text PRIMARY KEY NOT NULL,
	`data_json` text NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT "dashboard_roastery_lab_cropster_part" CHECK("dashboard_roastery_lab_cropster"."part" IN ('inventory', 'recipes', 'use', 'loss'))
);
--> statement-breakpoint
CREATE TABLE `dashboard_roastery_lab_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`releases_json` text NOT NULL,
	`qa` text NOT NULL,
	`revision` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "dashboard_roastery_lab_settings_one_record" CHECK("dashboard_roastery_lab_settings"."id" = 'lab')
);
