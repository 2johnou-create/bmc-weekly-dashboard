import assert from "node:assert/strict";
import test from "node:test";
import { readWarehouseWeather } from "../worker/weather.js";

const now = new Date("2026-11-18T21:10:00Z");
const url = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=-33.91&lon=151.16";
const updatedAt = "2026-11-18T19:00:00Z";
function fixture({ at = now, temperatureC = 21, updated = updatedAt } = {}) {
  const hour = Math.floor(at.getTime() / 3_600_000) * 3_600_000;
  return {
    type: "Feature", geometry: { type: "Point", coordinates: [151.16, -33.91, 5] },
    properties: {
      meta: { updated_at: updated, units: { air_temperature: "celsius" } },
      timeseries: Array.from({ length: 8 }, (_, index) => ({
        time: new Date(hour + index * 3_600_000).toISOString().replace(".000Z", "Z"),
        data: { instant: { details: { air_temperature: temperatureC + index } } },
      })),
    },
  };
}

test("Marrickville weather preserves Celsius, forecast validity and the model publication time", async () => {
  const fetcher = async (target, options) => {
    assert.equal(target, url);
    assert.equal(options.redirect, "manual");
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(Object.keys(options.headers), ["Accept", "User-Agent"]);
    assert.match(options.headers["User-Agent"], /BMCWeeklyDashboard.*chatgpt\.site.*roaster@blackmarketroasters\.com\.au/);
    return Response.json(fixture({ temperatureC: 0 }));
  };
  const result = await readWarehouseWeather({ now, fetcher });
  assert.equal(result.status, "available");
  assert.equal(result.temperatureC, 0);
  assert.equal(result.time, "2026-11-18T21:00:00.000Z");
  assert.equal(result.asOf, "2026-11-18T19:00:00.000Z");
  assert.equal(result.location, "Marrickville");
  assert.equal(result.sourceUrl, url);
  assert.equal(result.licenseUrl, "https://api.met.no/doc/License");
  assert.match(result.note, /outdoor forecast from MET Norway \(CC BY 4\.0\)/);
});

test("cached forecasts choose the new nearest hour and manual refresh respects the provider minimum", async () => {
  let calls = 0;
  const fetcher = async () => { calls++; return Response.json(fixture()); };
  assert.equal((await readWarehouseWeather({ now, fetcher })).temperatureC, 21);
  const later = new Date("2026-11-18T22:10:00Z");
  assert.equal((await readWarehouseWeather({ now: later, fetcher, fresh: true })).temperatureC, 22);
  assert.equal((await readWarehouseWeather({ now: later, fetcher })).time, "2026-11-18T22:00:00.000Z");
  assert.equal(calls, 1);
});

test("provider Expires and conditional revalidation preserve the original source timestamp", async () => {
  let calls = 0;
  const lastModified = "Wed, 18 Nov 2026 20:00:00 GMT";
  const fetcher = async (_url, options) => {
    calls++;
    if (calls === 1) return Response.json(fixture(), { headers: { Expires: "Thu, 19 Nov 2026 01:10:00 GMT", "Last-Modified": lastModified } });
    assert.equal(options.headers["If-Modified-Since"], lastModified);
    assert.equal(options.headers["Cache-Control"], "no-cache");
    return new Response(null, { status: 304 });
  };
  await readWarehouseWeather({ now, fetcher });
  assert.equal((await readWarehouseWeather({ now: new Date("2026-11-19T00:20:00Z"), fetcher, fresh: true })).temperatureC, 24);
  assert.equal(calls, 1);
  const revalidated = await readWarehouseWeather({ now: new Date("2026-11-19T01:10:00Z"), fetcher, fresh: true });
  assert.equal(revalidated.status, "available");
  assert.equal(revalidated.temperatureC, 25);
  assert.equal(revalidated.asOf, "2026-11-18T19:00:00.000Z");
  assert.equal(calls, 2);
});

test("old model publications and distant forecast points are visibly stale", async () => {
  const old = fixture({ updated: "2026-11-18T08:00:00Z" });
  const distant = fixture();
  distant.properties.timeseries = [distant.properties.timeseries[1]];
  for (const data of [old, distant]) {
    const result = await readWarehouseWeather({ now, fetcher: async () => Response.json(data) });
    assert.equal(result.status, "stale");
    assert.equal(typeof result.temperatureC, "number");
    assert.match(result.note, /out of date/);
  }
});

test("wrong location, unit, temperature or source times cannot produce a temperature", async () => {
  const variants = [
    data => { data.geometry.coordinates = [0, 0]; },
    data => { data.properties.meta.units.air_temperature = "fahrenheit"; },
    data => { data.properties.meta.updated_at = "2026-11-19T19:00:00Z"; },
    data => { data.properties.meta.updated_at = "2026-11-31T19:00:00Z"; },
    data => { data.properties.timeseries[0].data.instant.details.air_temperature = "21"; },
    data => { data.properties.timeseries[0].data.instant.details.air_temperature = 100; },
    data => { data.properties.timeseries[1].time = data.properties.timeseries[0].time; },
    data => { data.properties.timeseries = []; },
  ];
  for (const mutate of variants) {
    const data = fixture();
    mutate(data);
    const result = await readWarehouseWeather({ now, fetcher: async () => Response.json(data) });
    assert.equal(result.status, "unavailable");
    assert.equal(result.temperatureC, null);
    assert.equal(result.time, null);
    assert.equal(result.asOf, null);
  }
});

test("redirects, non-JSON, oversized and failed responses fail closed with a bounded retry", async () => {
  for (const response of [
    () => new Response(null, { status: 302, headers: { Location: "https://elsewhere.test" } }),
    () => new Response("<html>blocked</html>", { headers: { "content-type": "text/html" } }),
    () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "256001" } }),
    () => new Response(" ".repeat(256001), { headers: { "content-type": "application/json" } }),
    () => new Response(null, { status: 503 }),
  ]) {
    let calls = 0;
    const fetcher = async () => { calls++; return response(); };
    const result = await readWarehouseWeather({ now, fetcher });
    assert.equal(result.status, "unavailable");
    assert.equal(result.temperatureC, null);
    await readWarehouseWeather({ now, fetcher, fresh: true });
    assert.equal(calls, 1);
  }
});

test("concurrent readers share one source fetch", async () => {
  const pending = Promise.withResolvers();
  let calls = 0;
  const fetcher = async () => { calls++; await pending.promise; return Response.json(fixture()); };
  const one = readWarehouseWeather({ now, fetcher });
  const two = readWarehouseWeather({ now, fetcher, fresh: true });
  pending.resolve();
  assert.equal((await one).temperatureC, 21);
  assert.equal((await two).temperatureC, 21);
  assert.equal(calls, 1);
});

test("an older request's result cannot replace or invalidate a newer eligible read", async () => {
  for (const olderFails of [false, true]) {
    const pending = Promise.withResolvers();
    let calls = 0;
    const later = new Date(now.getTime() + 3 * 3_600_000);
    const fetcher = async () => {
      calls++;
      if (calls === 1) {
        await pending.promise;
        return olderFails ? new Response(null, { status: 503 }) : Response.json(fixture());
      }
      return Response.json(fixture({ at: later, temperatureC: 30, updated: "2026-11-19T00:00:00Z" }));
    };
    const older = readWarehouseWeather({ now, fetcher });
    assert.equal((await readWarehouseWeather({ now: later, fetcher, fresh: true })).temperatureC, 30);
    pending.resolve();
    await older;
    assert.equal((await readWarehouseWeather({ now: later, fetcher })).temperatureC, 30);
    assert.equal(calls, 2);
  }
});

test("a failed eligible manual refresh clears an earlier forecast instead of showing it as current", async () => {
  let calls = 0;
  const fetcher = async () => ++calls === 1 ? Response.json(fixture()) : new Response(null, { status: 503 });
  await readWarehouseWeather({ now, fetcher });
  const later = new Date(now.getTime() + 3 * 3_600_000);
  assert.equal((await readWarehouseWeather({ now: later, fetcher, fresh: true })).status, "unavailable");
  assert.equal((await readWarehouseWeather({ now: later, fetcher })).temperatureC, null);
  assert.equal(calls, 2);
});

test("a synchronous transport failure can recover after the provider retry interval", async () => {
  let calls = 0;
  const fetcher = () => {
    if (++calls === 1) throw new Error("Network failed before creating a response.");
    return Promise.resolve(Response.json(fixture()));
  };
  assert.equal((await readWarehouseWeather({ now, fetcher })).status, "unavailable");
  const later = new Date(now.getTime() + 3 * 3_600_000);
  assert.equal((await readWarehouseWeather({ now: later, fetcher, fresh: true })).status, "available");
  assert.equal(calls, 2);
});
