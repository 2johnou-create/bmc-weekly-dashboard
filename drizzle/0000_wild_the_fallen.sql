CREATE TABLE `dashboard_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`issue_date` text NOT NULL,
	`customer` text DEFAULT '' NOT NULL,
	`order_reference` text DEFAULT '' NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`resolved_at` integer,
	CONSTRAINT "dashboard_issues_status_check" CHECK("dashboard_issues"."status" IN ('open', 'resolved'))
);
--> statement-breakpoint
CREATE INDEX `dashboard_issues_status_updated_idx` ON `dashboard_issues` (`status`,`updated_at`);