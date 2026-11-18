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
  greenKg: real("green_kg").notNull(),
  greenValue: real("green_value"),
  recordedAt: integer("recorded_at").notNull(),
}, table => [
  index("dashboard_cropster_readings_recorded_idx").on(table.recordedAt, table.weekStart),
]);
