import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";

test("the warehouse page permits its bundled scene while keeping the other dashboards' script policy", async () => {
  const response = await worker.fetch(new Request("https://dashboard.test/warehouse"), {});
  assert.equal(response.status, 200);
  assert.match(await response.text(), /Warehouse/);
  assert.match(response.headers.get("content-security-policy"), /script-src 'self' 'sha256-/);
  const original = await worker.fetch(new Request("https://dashboard.test/"), {});
  assert.doesNotMatch(original.headers.get("content-security-policy"), /script-src 'self'/);
  assert.match(await original.text(), /href="\/warehouse"/);
});

test("guests cannot trigger warehouse source reads or expose business data", async () => {
  const fetcher = globalThis.fetch;
  globalThis.fetch = () => assert.fail("Guest warehouse requests must not read upstream data");
  try {
    const db = { prepare() { assert.fail("Guest warehouse requests must not read private records"); } };
    const response = await worker.fetch(new Request("https://dashboard.test/api/warehouse"), { DB: db });
    assert.equal(response.status, 401);
    assert.match(response.headers.get("cache-control"), /no-store/);
    assert.deepEqual(Object.keys(await response.json()), ["error"]);
    const mutation = await worker.fetch(new Request("https://dashboard.test/api/warehouse", { method: "POST" }), { DB: db });
    assert.equal(mutation.status, 405);
    assert.equal(mutation.headers.get("allow"), "GET");
  } finally { globalThis.fetch = fetcher; }
});
