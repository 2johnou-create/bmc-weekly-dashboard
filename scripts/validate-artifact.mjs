import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const workerPath = resolve(projectRoot, "dist/server/index.js");
const manifestPath = resolve(projectRoot, "dist/.openai/hosting.json");

const [source, manifest] = await Promise.all([
  readFile(workerPath, "utf8"),
  readFile(manifestPath, "utf8"),
]);
JSON.parse(manifest);
const hosting = JSON.parse(manifest);
assert.equal(hosting.d1, "DB", "Shared issue notes require the D1 binding.");
const journal = JSON.parse(await readFile(resolve(projectRoot, "dist/.openai/drizzle/meta/_journal.json"), "utf8"));
assert.ok(journal.entries.length, "The issue-note schema migration must be packaged.");
for (const entry of journal.entries) {
  const sql = await readFile(resolve(projectRoot, `dist/.openai/drizzle/${entry.tag}.sql`), "utf8");
  assert.ok(sql.trim());
}

// A data URL forces ESM parsing even though the generated output has no package.json.
const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
const workerModule = await import(moduleUrl);
assert.equal(
  typeof workerModule.default?.fetch,
  "function",
  `${pathToFileURL(workerPath)} must export default.fetch`,
);

console.log("Artifact is valid ESM and exports default.fetch");
