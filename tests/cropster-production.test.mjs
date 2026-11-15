import test from "node:test";
import assert from "node:assert/strict";
import { readCropsterProduction } from "../worker/cropster-production.js";

const env = { CROPSTER_CLIENT_ID: "test-client", CROPSTER_CLIENT_SECRET: "test-secret" };
const now = new Date("2026-11-16T03:00:00Z");
const weekStart = "2026-11-09";
const endpoint = "https://api.cropster.com/rpc/v1/inventory.roast.listRoastedLots";

function lot(index, roastedDate, amount, unit = "KG") {
  return {
    id: `ac937df2-d7ae-4663-a87d-${index.toString().padStart(12, "0")}`,
    roastedDate,
    weight: { amount, unit },
  };
}

function fakeCropster(pages) {
  const requests = [];
  const fetcher = async (url, options) => {
    if (url === "https://auth.cropster.com/oauth2/token") {
      assert.equal(options.method, "POST");
      assert.equal(options.redirect, "error");
      assert.deepEqual(Object.fromEntries(options.body.entries()), {
        grant_type: "client_credentials",
        client_id: env.CROPSTER_CLIENT_ID,
        client_secret: env.CROPSTER_CLIENT_SECRET,
        scope: "inventory.roast",
      });
      return Response.json({ access_token: "test-token", expires_in: 900, token_type: "bearer" });
    }
    assert.equal(url, endpoint);
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, "Bearer test-token");
    const request = JSON.parse(options.body).params;
    requests.push(request);
    const { rows, cursor = null } = pages[requests.length - 1];
    return Response.json({ ok: true, result: { roastedLots: rows }, meta: { pagination: { endCursor: cursor } } });
  };
  return { fetcher, requests };
}

test("unconfigured sources do not fetch or substitute another roast source", async () => {
  const result = await readCropsterProduction({ weekStart, now, env: { CROPSTER_CLIENT_ID: "incomplete" }, fetcher: () => assert.fail("unexpected upstream call") });
  assert.equal(result.status, "unavailable");
  assert.equal(result.source, "Cropster");
  assert.equal(result.roastedKg, null);
  assert.equal(result.scheduledKg, null);
  assert.deepEqual(result.byDay, []);
});

test("counts only unique Cropster output, with Monday and Friday in Sydney", async () => {
  const friday = {
    ...lot(1, "2026-11-12T13:00:00Z", 100),
    greenLots: [{ usedWeight: { amount: 80, unit: "KG" } }, { usedWeight: { amount: 45, unit: "KG" } }],
  };
  const { fetcher, requests } = fakeCropster([
    { rows: [lot(2, "2026-11-15T13:00:00Z", 900), friday, lot(3, "2026-11-08T13:00:00Z", 10, "LBS")], cursor: "next-lots-page" },
    { rows: [friday, lot(4, "2026-11-08T12:59:59Z", 80), lot(5, "2026-11-01T12:59:59Z", 900)] },
  ]);
  const result = await readCropsterProduction({ weekStart, env, now, fetcher });
  assert.equal(requests[0].filter.roastedDate.from, "2026-11-01T13:00:00.000Z");
  assert.equal(requests[0].pagination.after, null);
  assert.equal(requests[1].pagination.after, "next-lots-page");
  assert.equal(result.status, "partial");
  assert.equal(result.roastedKg, 104.54);
  assert.equal(result.previousRoastedKg, 80);
  assert.equal(result.roastedChangePercent, 30.7);
  assert.equal(result.totalKg, null);
  assert.equal(result.changePercent, null);
  assert.equal(result.scheduledKg, null);
  assert.deepEqual(result.byDay[4], { date: "2026-11-13", kg: 100 });
  assert.equal(result.days, 2);
});

test("an exhausted empty Cropster result is a measured zero without a percentage baseline", async () => {
  const { fetcher } = fakeCropster([{ rows: [] }]);
  const result = await readCropsterProduction({ weekStart, env, now, fetcher });
  assert.equal(result.roastedKg, 0);
  assert.equal(result.previousRoastedKg, 0);
  assert.equal(result.roastedChangePercent, null);
  assert.equal(result.days, 0);
  assert.equal(result.byDay.length, 7);
});

test("missing weights and conflicting IDs withhold the affected comparison", async () => {
  const { fetcher } = fakeCropster([{ rows: [
    lot(1, "2026-11-10T00:00:00Z", 42),
    lot(1, "2026-11-10T00:00:00Z", 43),
    lot(2, "2026-11-12T00:00:00Z", undefined),
    lot(3, "2026-11-04T00:00:00Z", 90),
  ] }]);
  const result = await readCropsterProduction({ weekStart, env, now, fetcher });
  assert.equal(result.roastedKg, null);
  assert.equal(result.previousRoastedKg, 90);
  assert.equal(result.roastedChangePercent, null);
  assert.deepEqual(result.byDay, []);
});

test("a repeated cursor withholds both potentially incomplete totals", async () => {
  const { requests, fetcher } = fakeCropster([
    { rows: [lot(1, "2026-11-10T00:00:00Z", 42)], cursor: "stuck-cursor" },
    { rows: [], cursor: "stuck-cursor" },
  ]);
  const result = await readCropsterProduction({ weekStart, env, now, fetcher });
  assert.equal(requests.length, 2);
  assert.equal(result.status, "unavailable");
  assert.equal(result.roastedKg, null);
  assert.equal(result.previousRoastedKg, null);
});

test("OAuth failures produce a safe status and omit the provider response", async () => {
  const result = await readCropsterProduction({ weekStart, env, now, fetcher: async () => Response.json({ error: "test-secret unexpectedly echoed" }, { status: 401 }) });
  assert.equal(result.status, "unavailable");
  assert.match(result.note, /service account and roast inventory scope/i);
  assert.doesNotMatch(JSON.stringify(result), /test-secret/);
});
