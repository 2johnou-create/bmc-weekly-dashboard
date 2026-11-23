import { sqliteTable, text, integer, real, index, uniqueIndex, check } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

export const dashboardIssues = sqliteTable("dashboard_issues", {
  id: text("id").primaryKey(),
  issueDate: text("issue_date").notNull(),
  customer: text("customer").notNull().default(""),
  orderReference: text("order_reference").notNull().default(""),
  note: text("note").notNull(),
  status: text("status").notNull().default("open"),
  revision: integer("revision").notNull().default(1),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  resolvedAt: integer("resolved_at"),
}, table => [
  index("dashboard_issues_status_updated_idx").on(table.status, table.updatedAt),
  check("dashboard_issues_status_check", sql`${table.status} IN ('open', 'resolved')`),
]);

export const dashboardCropsterReadings = sqliteTable("dashboard_cropster_readings", {
  weekStart: text("week_start").primaryKey(),
  roastedKg: real("roasted_kg").notNull(),
  scheduledKg: real("scheduled_kg"),
  roastedValue: real("roasted_value"),
  scheduledValue: real("scheduled_value"),
  previousRoastedKg: real("previous_roasted_kg"),
  previousScheduledKg: real("previous_scheduled_kg"),
  previousRoastedValue: real("previous_roasted_value"),
  previousScheduledValue: real("previous_scheduled_value"),
  greenKg: real("green_kg"),
  greenValue: real("green_value"),
  recordedAt: integer("recorded_at").notNull(),
}, table => [
  index("dashboard_cropster_readings_recorded_idx").on(table.recordedAt, table.weekStart),
]);

export const dashboardCropsterMonday = sqliteTable("dashboard_cropster_monday", {
  weekStart: text("week_start").primaryKey(),
  roastedKg: real("roasted_kg").notNull(),
  recordedAt: integer("recorded_at").notNull(),
});

export const dashboardCropsterScheduledBatches = sqliteTable("dashboard_cropster_scheduled_batches", {
  weekStart: text("week_start").primaryKey(),
  greenKg: real("green_kg").notNull(),
  batches: integer("batches").notNull(),
  recordedAt: integer("recorded_at").notNull(),
}, table => [
  check("dashboard_cropster_scheduled_batches_week", sql`strftime('%w', ${table.weekStart}) = '1'`),
  check("dashboard_cropster_scheduled_batches_amounts", sql`${table.greenKg} >= 0 AND ${table.greenKg} <= 1000000 AND ${table.batches} >= 0 AND ${table.batches} <= 100000 AND ${table.batches} = CAST(${table.batches} AS INTEGER) AND ((${table.greenKg} = 0 AND ${table.batches} = 0) OR (${table.greenKg} > 0 AND ${table.batches} > 0)) AND ${table.recordedAt} >= 0`),
]);

export const dashboardCropsterGreenStock = sqliteTable("dashboard_cropster_green_stock", {
  location: text("location").primaryKey(),
  kg: real("kg").notNull(),
  value: real("value"),
  recordedAt: integer("recorded_at").notNull(),
}, table => [
  check("dashboard_cropster_green_stock_marrickville", sql`${table.location} = 'Marrickville'`),
]);

export const dashboardWeeklyNotes = sqliteTable("dashboard_weekly_notes", {
  weekStart: text("week_start").primaryKey(),
  lines: text("lines_json").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const dashboardCropsterFriday = sqliteTable("dashboard_cropster_friday", {
  weekStart: text("week_start").primaryKey(),
  roastedKg: real("roasted_kg"),
  roastedValue: real("roasted_value"),
  greenKg: real("green_kg"),
  greenValue: real("green_value"),
  productionReadAt: integer("production_read_at"),
  greenReadAt: integer("green_read_at"),
});

export const dashboardRoasteryLabSettings = sqliteTable("dashboard_roastery_lab_settings", {
  id: text("id").primaryKey(),
  releases: text("releases_json").notNull(),
  qa: text("qa").notNull(),
  revision: integer("revision").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  check("dashboard_roastery_lab_settings_one_record", sql`${table.id} = 'lab'`),
]);

export const dashboardRoasteryLabCropster = sqliteTable("dashboard_roastery_lab_cropster", {
  part: text("part").primaryKey(),
  data: text("data_json").notNull(),
  recordedAt: integer("recorded_at").notNull(),
}, table => [
  check("dashboard_roastery_lab_cropster_part", sql`${table.part} IN ('inventory', 'recipes', 'use', 'loss')`),
]);

export const warehouseExpenseReadings = sqliteTable("warehouse_expense_readings", {
  weekStart: text("week_start").primaryKey(),
  payload: text("payload_json").notNull(),
  capturedAt: integer("captured_at").notNull(),
});

export const warehouseRoasterMessages = sqliteTable("warehouse_roaster_messages", {
  id: text("id").primaryKey(),
  digest: text("digest").notNull(),
  status: text("status").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [
  check("warehouse_roaster_messages_status", sql`${table.status} IN ('queued', 'sent')`),
]);

export const warehouseJohnCheers = sqliteTable("warehouse_john_cheers", {
  id: text("id").primaryKey(),
  occurredAt: integer("occurred_at").notNull(),
  receivedAt: integer("received_at").notNull(),
  weekStart: text("week_start").notNull(),
}, table => [
  index("warehouse_john_cheers_week_received_idx").on(table.weekStart, table.receivedAt),
]);

export const dashboardSourceSyncLog = sqliteTable("dashboard_source_sync_log", {
  id: text("id").primaryKey(),
  weekStart: text("week_start").notNull(),
  checkedAt: integer("checked_at").notNull(),
  status: text("status").notNull(),
  sourceStatus: text("source_status_json").notNull(),
}, table => [index("dashboard_source_sync_checked").on(table.checkedAt)]);

export const dashboardSourceJobs = sqliteTable("dashboard_source_jobs", {
  id:text("id").primaryKey(),publicId:text("public_id").unique(),weekStart:text("week_start").notNull(),
  phase:text("phase").notNull(),readerJobId:text("reader_job_id"),requestId:text("request_id").notNull(),
  manualRequestId:text("manual_request_id"),startedAt:integer("started_at").notNull(),updatedAt:integer("updated_at").notNull(),
  finishedAt:integer("finished_at"),nextAttemptAt:integer("next_attempt_at").notNull().default(0),
  leaseOwner:text("lease_owner"),leaseUntil:integer("lease_until").notNull().default(0),
  attempts:integer("attempts").notNull().default(0),safeCode:text("safe_code"),summaryJson:text("summary_json"),
}, table => [
  uniqueIndex("dashboard_source_jobs_active_week").on(table.weekStart).where(sql`${table.phase} IN ('warming','starting','reading')`),
  index("dashboard_source_jobs_latest_week").on(table.weekStart,sql`${table.startedAt} DESC`),
  index("dashboard_source_jobs_reader").on(table.readerJobId),
  check("dashboard_source_jobs_phase",sql`${table.phase} IN ('warming','starting','reading','complete','failed')`),
]);

export const dashboardPrivateRoastTallies = sqliteTable("dashboard_private_roast_tallies", {
  weekStart: text("week_start").primaryKey(),
  fileId: text("file_id").notNull(),
  modifiedAt: integer("modified_at").notNull(),
  checkedAt: integer("checked_at").notNull(),
  demandKg: real("demand_kg").notNull(),
  brownStockKg: real("brown_stock_kg"),
}, table => [
  check("dashboard_private_tally_kg", sql`${table.demandKg} >= 0 AND ${table.demandKg} <= 1000000`),
  check("dashboard_private_tally_stock", sql`${table.brownStockKg} >= 0 AND ${table.brownStockKg} <= 1000000`),
]);
