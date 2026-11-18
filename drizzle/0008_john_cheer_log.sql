CREATE TABLE `warehouse_john_cheers` (
	`id` text PRIMARY KEY NOT NULL,
	`occurred_at` integer NOT NULL,
	`received_at` integer NOT NULL,
	`week_start` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `warehouse_john_cheers_week_received_idx` ON `warehouse_john_cheers` (`week_start`,`received_at`);