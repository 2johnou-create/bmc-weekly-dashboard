CREATE TABLE `dashboard_private_roast_tallies` (
	`week_start` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`modified_at` integer NOT NULL,
	`checked_at` integer NOT NULL,
	`demand_kg` real NOT NULL,
	`brown_stock_kg` real,
	CONSTRAINT "dashboard_private_tally_kg" CHECK("dashboard_private_roast_tallies"."demand_kg" >= 0 AND "dashboard_private_roast_tallies"."demand_kg" <= 1000000),
	CONSTRAINT "dashboard_private_tally_stock" CHECK("dashboard_private_roast_tallies"."brown_stock_kg" >= 0 AND "dashboard_private_roast_tallies"."brown_stock_kg" <= 1000000)
);
