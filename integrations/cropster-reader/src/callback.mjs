import { ReaderError } from "./errors.mjs";

export function callbackConfiguration(env) {
  const address = env.DASHBOARD_SYNC_URL, token = env.DASHBOARD_SYNC_TOKEN;
  const expectedHost = env.DASHBOARD_SYNC_HOST;
  if (expectedHost !== undefined && expectedHost !== "" && !/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(expectedHost)) throw new ReaderError("CONFIGURATION_REQUIRED");
  if (!address && !token) return null;
  if (typeof address !== "string" || typeof token !== "string" || !/^[A-Za-z0-9_-]{32,256}$/.test(token)) throw new ReaderError("CONFIGURATION_REQUIRED");
  let url;
  try { url = new URL(address); } catch { throw new ReaderError("CONFIGURATION_REQUIRED"); }
  const allowedHost = expectedHost ? url.hostname === expectedHost : url.hostname.endsWith(".chatgpt.site");
  if (url.protocol !== "https:" || !allowedHost || url.username || url.password || url.port || url.search || url.hash
    || url.pathname !== "/api/integrations/cropster") throw new ReaderError("CONFIGURATION_REQUIRED");
  return { url: url.href, token };
}

async function acknowledged(response) {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") || "")) return false;
  if (Number(response.headers.get("content-length")) > 4096) return false;
  const reader = response.body?.getReader();
  if (!reader) return false;
  let size = 0, text = "";
  const decoder = new TextDecoder();
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > 4096) { await reader.cancel(); return false; }
      text += decoder.decode(chunk.value, { stream: true });
    }
    try { return JSON.parse(text + decoder.decode())?.ok === true; }
    catch { return false; }
  } finally { reader.releaseLock(); }
}

// Completion ingestion is independent of any browser visitor remaining on the
// dashboard. This never follows a redirect or returns transport/page errors.
export async function deliverCapture(configuration, payload, {
  fetcher = fetch,
  sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
} = {}) {
  if (!configuration) return "not-configured";
  const body = JSON.stringify(payload);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const response = await fetcher(configuration.url, {
        method: "POST", redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(12000),
        headers: { Authorization: "Bearer " + configuration.token, "Content-Type": "application/json", Accept: "application/json" }, body,
      });
      if (await acknowledged(response)) return "saved";
      await response.body?.cancel().catch(() => {});
      // Configuration/auth errors and redirects need an operator fix. A token
      // must never be replayed to an indicated Location.
      if (response.status >= 300 && response.status < 500 && response.status !== 429) return "failed";
    } catch { /* Deliberately discard errors that can include a secret URL/header. */ }
    if (attempt < 2) await sleep((attempt + 1) * 1000);
  }
  return "failed";
}
