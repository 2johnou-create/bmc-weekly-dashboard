import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import vm from "node:vm";
import test from "node:test";
import { localDatabase } from "../scripts/local-db.mjs";
import { roasterMessagingCapability, sendRoasterMessage } from "../worker/roaster-messages.js";

const env = {
  GOOGLE_BRIDGE_URL: "https://script.google.com/macros/s/testDeployment000000000000000/exec",
  GOOGLE_BRIDGE_TOKEN: "synthetic-test-bridge-token-000000000000001",
};
const bridgeSource = readFileSync(new URL("../integrations/warehouse-bridge/Code.gs", import.meta.url), "utf8");

function googleFixture() {
  const properties = new Map([["BRIDGE_TOKEN", env.GOOGLE_BRIDGE_TOKEN]]);
  const state = { emails: [], reads: [], throwMail: false, quota: 100, locked: false };
  const services = {
    PropertiesService: { getScriptProperties: () => ({
      getProperty: key => properties.get(key) ?? null,
      setProperty: (key, value) => properties.set(key, value),
    }) },
    LockService: { getScriptLock: () => ({
      tryLock: () => !state.locked,
      releaseLock() {},
    }) },
    MailApp: {
      getRemainingDailyQuota: () => state.quota,
      sendEmail: options => {
        if (state.throwMail) throw new Error("Synthetic uncertain mail failure");
        state.emails.push(options);
      },
    },
    Sheets: { Spreadsheets: { Values: { batchGet: (id, options) => {
      state.reads.push({ id, options });
      const values = options.valueRenderOption === "FORMATTED_VALUE" ? [["", "16/11/2026"], ["Cost", "$10.50"]] : [["", 46342], ["Cost", 10.5]];
      return { valueRanges: [{ values }] };
    } } } },
    Utilities: {
      DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
      computeDigest: (_algorithm, value) => [...createHash("sha256").update(value).digest()],
    },
    ContentService: {
      MimeType: { JSON: "application/json" },
      createTextOutput: text => ({ text, setMimeType() { return this; } }),
    },
  };
  const context = vm.createContext(services);
  vm.runInContext(bridgeSource, context);
  function run(input) {
    context.requestEvent = { postData: { contents: JSON.stringify(input), type: "application/json" } };
    return JSON.parse(vm.runInContext("doPost(requestEvent)", context).text);
  }
  const fetcher = async (_url, options) => Response.json(run(JSON.parse(options.body)));
  return { state, properties, run, fetcher, context };
}

test("messaging capability is unavailable until a private Google bridge is configured", async () => {
  assert.deepEqual(roasterMessagingCapability({}), {
    available: false, recipient: "roaster@blackmarketroasters.com.au", note: "Sending email needs a one-time Google connection.",
  });
  assert.equal(roasterMessagingCapability(env).available, true);
  const result = await sendRoasterMessage(null, {}, { id: randomUUID(), message: "A review message" });
  assert.equal(result.status, "unavailable");
});

test("a confirmed send is durable and duplicate retries cannot send another email", async () => {
  const directory = mkdtempSync(join(tmpdir(), "warehouse-mail-"));
  const filename = join(directory, "messages.sqlite");
  let db = localDatabase(filename);
  const bridge = googleFixture();
  const input = { id: randomUUID(), message: "  Check the Friday roast\r\nwhen ready.  " };
  try {
    const [left, right] = await Promise.all([
      sendRoasterMessage(db, env, input, { fetcher: bridge.fetcher }),
      sendRoasterMessage(db, env, input, { fetcher: bridge.fetcher }),
    ]);
    assert.equal(left.status, "sent");
    assert.equal(right.status, "sent");
    assert.equal(bridge.state.emails.length, 1);
    assert.equal(bridge.state.emails[0].to, "roaster@blackmarketroasters.com.au");
    assert.match(bridge.state.emails[0].body, /Check the Friday roast\nwhen ready\./);
    const record = await db.prepare("SELECT * FROM warehouse_roaster_messages WHERE id = ?").bind(input.id).first();
    assert.equal(record.status, "sent");
    assert.match(record.digest, /^[0-9a-f]{64}$/);
    assert.deepEqual(Object.keys(record).sort(), ["created_at", "digest", "id", "status", "updated_at"]);
    db.close();
    db = localDatabase(filename);
    const result = await sendRoasterMessage(db, env, input, { fetcher: async () => { throw new Error("Bridge must not be called again"); } });
    assert.equal(result.status, "sent");
    assert.equal(bridge.state.emails.length, 1);
    await assert.rejects(sendRoasterMessage(db, env, { ...input, message: "Different text" }, { fetcher: bridge.fetcher }), { status: 409 });
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test("a lost confirmation stays queued until the same ID checks the Google receipt", async () => {
  const db = localDatabase(":memory:");
  const bridge = googleFixture();
  const input = { id: randomUUID(), message: "Review the next batch." };
  try {
    const lost = await sendRoasterMessage(db, env, input, { fetcher: async (_url, options) => {
      bridge.run(JSON.parse(options.body));
      throw new Error("Synthetic response lost after delivery");
    } });
    assert.equal(lost.status, "queued");
    assert.equal(bridge.state.emails.length, 1);
    assert.equal((await db.prepare("SELECT status FROM warehouse_roaster_messages WHERE id = ?").bind(input.id).first()).status, "queued");
    const confirmed = await sendRoasterMessage(db, env, input, { fetcher: bridge.fetcher });
    assert.equal(confirmed.status, "sent");
    assert.equal(bridge.state.emails.length, 1);
  } finally { db.close(); }
});

test("uncertain Google sends and unavailable quotas are never reported as sent", async () => {
  const db = localDatabase(":memory:");
  const bridge = googleFixture();
  try {
    const input = { id: randomUUID(), message: "A single delivery attempt." };
    bridge.state.throwMail = true;
    assert.equal((await sendRoasterMessage(db, env, input, { fetcher: bridge.fetcher })).status, "queued");
    bridge.state.throwMail = false;
    assert.equal((await sendRoasterMessage(db, env, input, { fetcher: bridge.fetcher })).status, "queued");
    assert.equal(bridge.state.emails.length, 0);
    bridge.state.quota = 0;
    assert.equal((await sendRoasterMessage(db, env, { ...input, id: randomUUID() }, { fetcher: bridge.fetcher })).status, "unavailable");
    const mismatch = await sendRoasterMessage(db, env, { ...input, id: randomUUID() }, { fetcher: async () => Response.json({ id: randomUUID(), status: "sent" }) });
    assert.equal(mismatch.status, "queued");
  } finally { db.close(); }
});

test("message input accepts bounded text and rejects recipient overrides before contacting Google", async () => {
  const db = localDatabase(":memory:");
  let contacted = false;
  const options = { fetcher: async () => { contacted = true; throw new Error(); } };
  const valid = { id: randomUUID(), message: "A review message" };
  try {
    for (const input of [null, [], {}, { ...valid, id: "not-a-uuid" }, { ...valid, message: " " },
      { ...valid, message: "x".repeat(501) }, { ...valid, message: "bad\u0000input" },
      { ...valid, recipient: "another@example.invalid" }]) {
      await assert.rejects(sendRoasterMessage(db, env, input, options), { status: 400 });
    }
    assert.equal(contacted, false);
  } finally { db.close(); }
});

test("the Apps Script bridge authenticates both actions and reads only the fixed sheet range", () => {
  const bridge = googleFixture();
  assert.equal(bridge.run({ token: "incorrect", action: "message", id: randomUUID(), message: "No send" }).error, "Unauthorized.");
  assert.equal(bridge.state.emails.length, 0);
  const forbidden = bridge.run({ token: env.GOOGLE_BRIDGE_TOKEN, action: "expenses", spreadsheetId: "another-sheet" });
  assert.equal(forbidden.error, "Unsupported request.");
  assert.equal(bridge.state.reads.length, 0);
  const result = bridge.run({ token: env.GOOGLE_BRIDGE_TOKEN, action: "expenses" });
  assert.equal(result.sheetName, "Sheet1");
  assert.equal(result.range, "A1:W36");
  assert.equal(result.values.length, 36);
  assert.equal(result.values.every(row => row.length === 23), true);
  assert.equal(result.numericValues.length, 36);
  assert.equal(result.values[1][1], "$10.50");
  assert.equal(result.numericValues[1][1], 10.5);
  assert.equal(bridge.state.reads.length, 2);
  for (const request of bridge.state.reads) {
    assert.equal(request.id, "1rhkE1pU7kKoBSX1j9V_OpeAyGNzWIpCgcYxWYvwmpik");
    assert.deepEqual([...request.options.ranges], ["'Sheet1'!A1:W36"]);
  }
  vm.runInContext("authorizeBridge()", bridge.context);
  assert.equal(bridge.state.emails.length, 0);
});
