import { sqliteTable, text, integer, real, index, check } from "drizzle-orm/sqlite-core";
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
