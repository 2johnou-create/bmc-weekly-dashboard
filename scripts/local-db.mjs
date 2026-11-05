import { DatabaseSync } from "node:sqlite";
import { readdirSync, readFileSync } from "node:fs";

/** Local preview only. Hosted issue notes use the Site's D1 binding. */
export function localDatabase(filename, migrations = new URL("../drizzle/", import.meta.url)) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec("PRAGMA foreign_keys = ON");
  sqlite.exec("CREATE TABLE IF NOT EXISTS local_schema_migrations (filename TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)");
  for (const file of readdirSync(migrations).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
    if (sqlite.prepare("SELECT filename FROM local_schema_migrations WHERE filename = ?").get(file)) continue;
    sqlite.exec("BEGIN");
    try {
      sqlite.exec(readFileSync(new URL(file, migrations), "utf8"));
      sqlite.prepare("INSERT INTO local_schema_migrations VALUES (?, ?)").run(file, Date.now());
      sqlite.exec("COMMIT");
    } catch (error) { sqlite.exec("ROLLBACK"); sqlite.close(); throw error; }
  }
  const wrap = (sql, parameters = []) => ({
    bind(...values) { return wrap(sql, values); },
    async first(column) { const row = sqlite.prepare(sql).get(...parameters); return row ? column ? row[column] : row : null; },
    async all() { return { results: sqlite.prepare(sql).all(...parameters), success: true }; },
    async run() { const result = sqlite.prepare(sql).run(...parameters); return { success: true, meta: { changes: Number(result.changes) } }; },
  });
  return { prepare: sql => wrap(sql), close: () => sqlite.close() };
}
