import { sqliteTable, text, integer, index, check } from "drizzle-orm/sqlite-core";
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
