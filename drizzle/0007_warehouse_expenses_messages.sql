CREATE TABLE `warehouse_expense_readings` (
	`week_start` text PRIMARY KEY NOT NULL,
	`payload_json` text NOT NULL,
	`captured_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `warehouse_roaster_messages` (
	`id` text PRIMARY KEY NOT NULL,
	`digest` text NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT "warehouse_roaster_messages_status" CHECK("warehouse_roaster_messages"."status" IN ('queued', 'sent'))
);
