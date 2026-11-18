import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { localDatabase } from "../scripts/local-db.mjs";
import { sealSession } from "../worker/auth.js";
import { saveLabSettings } from "../worker/roastery-lab-settings.js";
import { sydneyDate } from "../worker/metrics.js";
import { zipSync, strToU8 } from "../vendor/fflate.mjs";

function purchaseWorkbook(value) {
  const inline = (ref, text) => '<c r="' + ref + '" t="inlineStr"><is><t>' + text + '</t></is></c>';
  const headers = ["SUPPLIER", "COFFEE", "INVOICE NUMBER", "DATE ORDERED", "PAY DUE DATE", "TOTAL DELIVERY COST"];
  const entries = {
    "xl/workbook.xml": '<workbook xmlns:r="relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="ORDER PLAN" sheetId="2" r:id="rId2"/></sheets></workbook>',
    "xl/_rels/workbook.xml.rels": '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    "xl/worksheets/sheet1.xml": "<worksheet><sheetData/></worksheet>",
    "xl/worksheets/sheet2.xml": "<worksheet><sheetData>" +
      headers.map((text, index) => inline(String.fromCharCode(66 + index) + "1", text)).join("") +
      inline("B2", "Example supplier") + inline("C2", "Example coffee " + value) +
      inline("D2", "ordered") + inline("E2", sydneyDate()) + '<c r="G2"><v>' + value + "</v></c></sheetData></worksheet>",
  };
  return zipSync(Object.fromEntries(Object.entries(entries).map(([path, text]) => [path, strToU8(text)])));
}

test("manual Lab refresh re-reads changed purchase and market sources inside their normal cache windows", async () => {
  const db = localDatabase(":memory:");
  const env = { DB: db, SESSION_SECRET: "synthetic-manual-refresh-session-key-123456789012345" };
  const origin = "https://dashboard.test";
  const originalFetch = globalThis.fetch;
  let sourceValue = 100;
  let purchaseReads = 0;
  let failSources = false;
  const today = new Date();
  const date = [today.getUTCMonth() + 1, today.getUTCDate(), today.getUTCFullYear()].map((value, index) => index < 2 ? String(value).padStart(2, "0") : value).join("/");
  const hour = today.getUTCHours() % 12 || 12;
  const time = date + " " + String(hour).padStart(2, "0") + ":" + String(today.getUTCMinutes()).padStart(2, "0") + (today.getUTCHours() >= 12 ? " PM" : " AM") + " GMT";
  globalThis.fetch = async (address) => {
    const url = new URL(address);
    if (url.hostname === "bmc-stockroom.misty-jelly-1931.chatgpt.site") return Response.json({ items: [] });
    if (failSources) return Response.json({}, { status: 503 });
    if (url.hostname === "www.ice.com") {
      if (url.pathname.endsWith("/expiry/csv")) return new Response('"CONTRACT SYMBOL","FTD","LTD"\n"=""Dec99""","01/01/2099","12/18/2099"\n', { headers: { "Content-Type": "text/csv" } });
      return Response.json([{ marketStrip: "Dec99", marketId: 777, lastPrice: sourceValue, lastTime: time, change: 0 }]);
    }
    assert.equal(url.hostname, "docs.google.com");
    purchaseReads++;
    return new Response(purchaseWorkbook(sourceValue));
  };
  try {
    const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_manual_refresh_source")).split(";")[0];
    const read = async (fresh = false) => {
      const response = await worker.fetch(new Request(origin + "/api/roastery-lab" + (fresh ? "?refresh=1" : ""), { headers: { Cookie: cookie } }), env);
      assert.equal(response.status, 200);
      return response.json();
    };
    const initial = await read();
    assert.equal(initial.purchases.events[0].value, 100);
    assert.equal(initial.coffeeC.price, 100);
    sourceValue = 200;
    const cached = await read();
    assert.equal(cached.purchases.events[0].value, 100);
    assert.equal(purchaseReads, 1);
    await saveLabSettings(db, { releases: [], qa: "New saved QA status", expectedRevision: 0 });
    const updated = await read(true);
    assert.equal(updated.purchases.events[0].value, 200);
    assert.equal(updated.coffeeC.price, 200);
    assert.equal(updated.settings.qa, "New saved QA status");
    assert.equal(purchaseReads, 2);
    assert.ok(Number.isFinite(Date.parse(updated.generatedAt)));
    failSources = true;
    const failed = await read(true);
    assert.equal(failed.purchases.status, "unavailable");
    assert.equal(failed.coffeeC.status, "unavailable");
    assert.equal(failed.settings.qa, "New saved QA status");
    failSources = false;
    sourceValue = 300;
    const recovered = await read();
    assert.equal(recovered.purchases.events[0].value, 300);
    assert.equal(recovered.coffeeC.price, 300);
  } finally { globalThis.fetch = originalFetch; db.close(); }
});
