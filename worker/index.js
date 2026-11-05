import { page } from "./ui.js";
import { collectDashboard, dashboardWeek } from "./metrics.js";
import { readWeeklyDemand } from "./demand.js";
import { HttpError, readSession, signIn, signOut, clearCookie } from "./auth.js";

const commonHeaders = {
  "Cache-Control": "no-store, private",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "X-Robots-Tag": "noindex, nofollow",
};
function json(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { ...commonHeaders, ...headers } }); }
let pageHeaders;
async function htmlHeaders() {
  if (!pageHeaders) {
    const scripts = [...page.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    const hashes = await Promise.all(scripts.map(async ([, script]) => {
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(script)));
      return `'sha256-${btoa(String.fromCharCode(...bytes))}'`;
    }));
    pageHeaders = { ...commonHeaders, "Content-Type": "text/html; charset=utf-8", "Content-Security-Policy": `default-src 'self'; script-src ${hashes.join(" ")}; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; font-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'self' https://chatgpt.com https://*.chatgpt.com` };
  }
  return pageHeaders;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/" && ["GET", "HEAD"].includes(request.method)) return new Response(request.method === "HEAD" ? null : page, { headers: await htmlHeaders() });
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204, headers: commonHeaders });
      if (url.pathname === "/robots.txt" && request.method === "GET") return new Response("User-agent: *\nDisallow: /\n", { headers: { ...commonHeaders, "Content-Type": "text/plain" } });
      if (url.pathname === "/api/health" && request.method === "GET") return json({ ok: true });
      if (url.pathname === "/api/auth") {
        if (request.method === "GET") return json({ authenticated: Boolean(await readSession(request, env)) });
        if (request.method === "POST") return json({ authenticated: true }, 200, { "Set-Cookie": await signIn(request, env) });
        if (request.method === "DELETE") return json({ authenticated: false }, 200, { "Set-Cookie": await signOut(request, env) });
        return json({ error: "Method not allowed." }, 405, { Allow: "GET, POST, DELETE" });
      }
      if (url.pathname === "/api/dashboard") {
        if (request.method !== "GET") return json({ error: "Method not allowed." }, 405, { Allow: "GET" });
        const session = await readSession(request, env);
        if (!session) return json({ error: "Sign in with your Stock Take App password." }, 401, { "Set-Cookie": clearCookie(request) });
        let week;
        try { week = dashboardWeek(url.searchParams.get("week") || undefined); }
        catch { return json({ error: "Choose this week or an earlier Monday." }, 400); }
        const [data, demand] = await Promise.all([
          collectDashboard({ weekStart: week.start, stockroomCookie: session.stockroomCookie, env }),
          readWeeklyDemand(week.start, env),
        ]);
        data.metrics.demand = demand;
        data.sources = data.sources.map(source => source.id === "green" ? { ...source, status: data.metrics.green.status, note: data.metrics.green.note } : source);
        data.sources.unshift({ id: "demand", label: "Weekly roast tally", status: demand.status, asOf: demand.asOf, note: demand.note, url: demand.url || null });
        return json(data);
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      if (error?.status === 401) return json({ error: error instanceof HttpError ? error.message : "Your Stockroom session has ended. Sign in again." }, 401, { "Set-Cookie": clearCookie(request) });
      if (error instanceof HttpError) return json({ error: error.message }, error.status, error.status === 429 ? { "Retry-After": "900" } : {});
      return json({ error: "The dashboard could not refresh. Please try again." }, 503);
    }
  },
};
