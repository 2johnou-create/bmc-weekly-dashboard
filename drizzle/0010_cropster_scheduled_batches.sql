CREATE TABLE `dashboard_cropster_scheduled_batches` (
	`week_start` text PRIMARY KEY NOT NULL,
	`green_kg` real NOT NULL,
	`batches` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	CONSTRAINT "dashboard_cropster_scheduled_batches_week" CHECK(strftime('%w', "dashboard_cropster_scheduled_batches"."week_start") = '1'),
	CONSTRAINT "dashboard_cropster_scheduled_batches_amounts" CHECK("dashboard_cropster_scheduled_batches"."green_kg" >= 0 AND "dashboard_cropster_scheduled_batches"."green_kg" <= 1000000 AND "dashboard_cropster_scheduled_batches"."batches" >= 0 AND "dashboard_cropster_scheduled_batches"."batches" <= 100000 AND "dashboard_cropster_scheduled_batches"."batches" = CAST("dashboard_cropster_scheduled_batches"."batches" AS INTEGER) AND (("dashboard_cropster_scheduled_batches"."green_kg" = 0 AND "dashboard_cropster_scheduled_batches"."batches" = 0) OR ("dashboard_cropster_scheduled_batches"."green_kg" > 0 AND "dashboard_cropster_scheduled_batches"."batches" > 0)) AND "dashboard_cropster_scheduled_batches"."recorded_at" >= 0)
);
