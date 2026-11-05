import assert from "node:assert/strict";
import test from "node:test";
import worker from "../worker/index.js";
import { sealSession } from "../worker/auth.js";
import { localDatabase } from "../scripts/local-db.mjs";
import { sydneyDate } from "../worker/metrics.js";

const env = { SESSION_SECRET: "synthetic-worker-test-secret-at-least-thirty-two-characters" };
const origin = "https://dashboard.test";

test("public page contains no operational snapshot and CSP permits only its exact script", async () => {
  const response = await worker.fetch(new Request(origin), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control"), /no-store/);
  const html = await response.text();
  assert.match(html, /Stock Take App password/);
  assert.doesNotMatch(html, /bmc123|SESSION_SECRET|bmc_stockroom_session=/);
  for (const [, script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    const hash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script))).toString("base64");
    assert.ok(response.headers.get("content-security-policy").includes(`'sha256-${hash}'`));
    new Function(script);
  }
});

test("unauthenticated and tampered sessions cannot trigger source reads", async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw new Error("No external requests allowed"); };
  try {
    for (const cookie of ["", "bmc_weekly_session=forged-session"]) {
      const response = await worker.fetch(new Request(origin + "/api/dashboard", { headers: { Cookie: cookie } }), env);
      assert.equal(response.status, 401);
      assert.deepEqual(Object.keys(await response.json()), ["error"]);
    }
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

test("valid sessions still cannot request invalid or future reporting weeks", async () => {
  const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_source_session_123456789")).split(";")[0];
  for (const date of ["2026-02-31", "2026-11-03", "2099-01-05"]) {
    const response = await worker.fetch(new Request(origin + "/api/dashboard?week=" + date, { headers: { Cookie: cookie } }), env);
    assert.equal(response.status, 400);
  }
});

test("auth endpoints do not accept cross-origin mutations or unsupported methods", async () => {
  assert.equal((await worker.fetch(new Request(origin + "/api/auth", { method: "DELETE", headers: {Origin:"https://other.test"} }), env)).status, 403);
  assert.equal((await worker.fetch(new Request(origin + "/api/dashboard", { method: "POST" }), env)).status, 405);
  const response = await worker.fetch(new Request(origin + "/api/auth"), env);
  assert.deepEqual(await response.json(), {authenticated:false});
});

test("issue APIs require current Stockroom authorization and enforce safe write origins", async () => {
  const db = localDatabase(":memory:");
  const configured = {...env, DB:db};
  const originalFetch = globalThis.fetch;
  let reads = 0;
  globalThis.fetch = async () => {reads++; return Response.json({error:"Unauthorized"},{status:401});};
  try {
    const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_source_session_123456789")).split(";")[0];
    assert.equal((await worker.fetch(new Request(origin+"/api/issues"), configured)).status, 401);
    assert.equal(reads, 0);
    assert.equal((await worker.fetch(new Request(origin+"/api/issues", {headers:{Cookie:cookie}}), configured)).status, 401);
    assert.equal((await worker.fetch(new Request(origin+"/api/issues", {method:"POST",headers:{Cookie:cookie,Origin:"https://other.test","Content-Type":"application/json"},body:"{}"}), configured)).status, 403);
    assert.equal(reads, 1);
    assert.equal((await db.prepare("SELECT COUNT(*) AS total FROM dashboard_issues").first()).total, 0);
  } finally {globalThis.fetch=originalFetch;db.close();}
});

test("issue workflow uses the migration schema, persists notes, and rejects stale edits", async () => {
  const db = localDatabase(":memory:");
  const configured = {...env, DB:db};
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {assert.equal(url,"https://bmc-stockroom.misty-jelly-1931.chatgpt.site/api/inventory");return Response.json({items:[]});};
  try {
    const cookie = (await sealSession(new Request(origin), env, "bmc_stockroom_session=synthetic_source_session_123456789")).split(";")[0];
    const headers={Cookie:cookie,Origin:origin,"Content-Type":"application/json"};
    const id=crypto.randomUUID();
    const input={id,issueDate:sydneyDate(),customer:"Synthetic customer",orderReference:"TEST-ONLY",note:"<script>Literal note text</script>"};
    const response=await worker.fetch(new Request(origin+"/api/issues",{method:"POST",headers,body:JSON.stringify(input)}),configured);
    assert.equal(response.status,201);
    assert.equal((await response.json()).item.note,input.note);
    const list=await worker.fetch(new Request(origin+"/api/issues",{headers}),configured);
    const saved=await list.json();assert.equal(saved.count,1);assert.equal(saved.items[0].id,id);
    const resolve=await worker.fetch(new Request(origin+"/api/issues/"+id,{method:"PATCH",headers,body:JSON.stringify({expectedRevision:1,action:"resolve"})}),configured);
    assert.equal(resolve.status,200);
    const stale=await worker.fetch(new Request(origin+"/api/issues/"+id,{method:"PATCH",headers,body:JSON.stringify({expectedRevision:1,action:"edit",note:"Old draft"})}),configured);
    assert.equal(stale.status,409);
    const final=await(await worker.fetch(new Request(origin+"/api/issues",{headers}),configured)).json();assert.equal(final.count,0);assert.equal(final.items[0].note,input.note);
    const large=await worker.fetch(new Request(origin+"/api/issues",{method:"POST",headers,body:JSON.stringify({note:"a".repeat(17000)})}),configured);
    assert.equal(large.status,413);
  } finally {globalThis.fetch=originalFetch;db.close();}
});
