import test from "node:test";
import assert from "node:assert/strict";
import { ONLINE_ORDERS_CSV_HEADERS, ONLINE_ORDERS_FOLDER_URL, readOnlineOrders, summarizeOnlineOrderFiles } from "../worker/online-orders.js";

const week = "2026-11-02";
const file = (body, extra = {}) => ({ text: ONLINE_ORDERS_CSV_HEADERS + body, modified: "2026-11-05T02:20:15.627Z", ...extra });
const id = "test_online_orders_csv_123456789";
function listing(files = []) {
  const rows = files.map((item, index) => [item.id || `${id}_${index}`, [], item.name || "online-orders.csv", item.mime || "text/csv", null, null, null, null, null, 0, 1793845215627]);
  const escaped = JSON.stringify([rows, null]).replace(/./g, char => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `<title>Dashboard Folder – Google Drive</title><script>window['_DRIVE_ivd'] = '${escaped}';</script>`;
}

test("deduplicates repeated order totals across line items and uploaded files", () => {
  const result = summarizeOnlineOrderFiles([
    file('1001,2026-11-02,40,AUD\n1001,,40,AUD\n1002,2026-11-03,60,AUD\n'),
    file('1001,2026-11-02,40,AUD\n'),
  ], week);
  assert.equal(result.orders, 2);
  assert.equal(result.value, 100);
  assert.equal(result.status, "live");
  assert.equal(result.asOf, "2026-11-05T02:20:15.627Z");
});

test("uses Sydney week boundaries for offset timestamps and treats date-only cells as Sydney dates", () => {
  const result = summarizeOnlineOrderFiles([file(
    '1001,2026-11-01T13:00:00Z,10,AUD\n' + // Monday midnight Sydney.
    '1002,2026-11-01T12:59:59Z,20,AUD\n' + // Prior Sunday Sydney.
    '1003,2026-11-08 23:59:59 +1100,30,AUD\n' +
    '1004,2026-11-09T00:00:00+11:00,40,AUD\n' +
    '1005,2026-11-02,50,AUD\n'
  )], week);
  assert.equal(result.orders, 3);
  assert.equal(result.value, 90);
});

test("never reports an empty file, an empty folder, or another week's orders as zero", async () => {
  for (const body of ["", "1001,2026-10-26,40,AUD\n"]) {
    const result = summarizeOnlineOrderFiles([file(body)], week);
    assert.equal(result.orders, null);
    assert.equal(result.value, null);
  }
  const result = await readOnlineOrders(week, { fetch: async () => new Response(listing()) });
  assert.equal(result.orders, null);
  assert.equal(result.value, null);
  assert.match(result.note, /Folder connected.*No orders file/);
});

test("allows count with unavailable money and rejects conflicting or mixed-currency values", () => {
  for (const body of [
    "1001,2026-11-02,,AUD\n",
    "1001,2026-11-02,40,\n",
    "1001,2026-11-02,40,AUD\n1001,,41,AUD\n",
    "1001,2026-11-02,40,AUD\n1002,2026-11-02,60,USD\n",
  ]) {
    const result = summarizeOnlineOrderFiles([file(body)], week);
    assert.ok(result.orders > 0);
    assert.equal(result.value, null);
    assert.equal(result.status, "partial");
  }
});

test("does not guess ambiguous dates or inherit missing dates from a different file", () => {
  const result = summarizeOnlineOrderFiles([
    file("1001,2026-11-02,40,AUD\n1002,02/11/26,60,AUD\n1003,2026-11-02T10:00:00,70,AUD\n"),
    file("1001,,40,AUD\n"),
  ], week);
  assert.equal(result.orders, null);
  assert.equal(result.value, null);
  assert.equal(result.status, "partial");
  assert.match(result.note, /valid order number|dated timestamp/);
});

test("handles BOM, quoted commas, escaped quotes and multiline CSV fields without exposing customer data", () => {
  const text = '\uFEFFOrder Number,Order Date,Order Total,Currency,Customer\r\n1001,2026-11-02,"$1,234.50",AUD,"Synthetic, Name\nwith ""quotes"""\r\n';
  const result = summarizeOnlineOrderFiles([{ text }], week);
  assert.equal(result.orders, 1);
  assert.equal(result.value, 1234.5);
  assert.equal(JSON.stringify(result).includes("Synthetic"), false);
  assert.equal(JSON.stringify(result).includes("1001"), false);
});

test("recognizes identifiable Shopify CSV headers without counting line items as orders", () => {
  const text = "Name,Created at,Total,Currency,Financial Status,Lineitem quantity,Lineitem price\n#1001,2026-11-02 10:00:00 +1100,100,AUD,paid,1,30\n#1001,,,,,2,35\n";
  const result = summarizeOnlineOrderFiles([{ text }], week);
  assert.equal(result.orders, 1);
  assert.equal(result.value, 100);
});

test("does not accept a generic customer Name column as an order identifier", () => {
  const result = summarizeOnlineOrderFiles([{ text: "Name,Order Date,Total,Currency\nSynthetic Person,2026-11-02,40,AUD\n" }], week);
  assert.equal(result.orders, null);
  assert.equal(result.value, null);
  assert.match(result.note, /could not be read/);
});

test("excludes explicitly cancelled and test orders; a dated file can prove zero active orders", () => {
  const text = "Order Number,Order Date,Order Total,Currency,Cancelled at,Test Order\n1001,2026-11-02,40,AUD,2026-11-03,false\n1002,2026-11-02,60,AUD,,true\n";
  const result = summarizeOnlineOrderFiles([{ text }], week);
  assert.equal(result.orders, 0);
  assert.equal(result.value, 0);
});

test("does not treat an invalid cancellation timestamp as proof that an order was cancelled", () => {
  const text = "Order Number,Order Date,Order Total,Currency,Cancelled at\n1001,2026-11-02,40,AUD,N/A\n";
  const result = summarizeOnlineOrderFiles([{ text }], week);
  assert.equal(result.orders, null);
  assert.equal(result.value, null);
  assert.equal(result.status, "partial");
});

test("incomplete file coverage clearly labels known counts and withholds total value", () => {
  const result = summarizeOnlineOrderFiles([file("1001,2026-11-02,40,AUD\n")], week, { incomplete: true });
  assert.equal(result.orders, 1);
  assert.equal(result.value, null);
  assert.equal(result.status, "partial");
  assert.match(result.note, /Known order count only/);
});

test("runtime reads only the configured folder and rejects an external redirect", async () => {
  const calls = [];
  const fetcher = async (url, options) => {
    calls.push({ url, options });
    if (url === ONLINE_ORDERS_FOLDER_URL) return new Response(listing([{}]));
    return new Response(null, { status: 302, headers: { location: "https://untrusted.example/orders.csv" } });
  };
  const result = await readOnlineOrders(week, { fetch: fetcher });
  assert.equal(result.orders, null);
  assert.ok(calls.every(call => !call.url.includes("untrusted.example")));
  assert.ok(calls.every(call => call.options.headers.Authorization === undefined));
});

test("runtime deduplicates all fetched CSV files and marks file limits as partial", async () => {
  let reads = 0;
  const fetcher = async url => {
    if (url === ONLINE_ORDERS_FOLDER_URL) return new Response(listing(Array.from({ length: 13 }, () => ({}))));
    reads++;
    return new Response(ONLINE_ORDERS_CSV_HEADERS + "1001,2026-11-02,40,AUD\n");
  };
  const result = await readOnlineOrders(week, { fetch: fetcher });
  assert.equal(reads, 12);
  assert.equal(result.orders, 1);
  assert.equal(result.value, null);
  assert.equal(result.status, "partial");
});

test("unsupported uploads do not fabricate zero orders", async () => {
  const result = await readOnlineOrders(week, { fetch: async () => new Response(listing([{ name: "online-orders.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }])) });
  assert.equal(result.orders, null);
  assert.match(result.note, /CSV.*other file formats/);
});

test("mixed supported and unsupported exports cannot look like complete coverage", async () => {
  const result = await readOnlineOrders(week, { fetch: async url => new Response(url === ONLINE_ORDERS_FOLDER_URL ? listing([{}, { name: "online-orders.xlsx", mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }]) : ONLINE_ORDERS_CSV_HEADERS + "1001,2026-11-02,40,AUD\n") });
  assert.equal(result.orders, 1);
  assert.equal(result.value, null);
  assert.equal(result.status, "partial");
  assert.match(result.note, /some files could not be read/);
});

test("an expired cache with a failed folder refresh returns unavailable, not old totals", async () => {
  let now = 100_000, online = true;
  const fetcher = async url => {
    if (!online) return new Response(null, { status: 503 });
    return new Response(url === ONLINE_ORDERS_FOLDER_URL ? listing([{}]) : ONLINE_ORDERS_CSV_HEADERS + "1001,2026-11-02,40,AUD\n");
  };
  const env = { fetch: fetcher, now: () => now };
  assert.equal((await readOnlineOrders(week, env)).orders, 1);
  now += 55_001; online = false;
  const result = await readOnlineOrders(week, env);
  assert.equal(result.orders, null);
  assert.equal(result.status, "unavailable");
});
