const MAX_BYTES = 128_000;

function configuration(env) {
  if (typeof env?.GOOGLE_BRIDGE_URL !== "string" || typeof env?.GOOGLE_BRIDGE_TOKEN !== "string"
    || env.GOOGLE_BRIDGE_TOKEN.length < 32 || env.GOOGLE_BRIDGE_TOKEN.length > 256 || /[\u0000-\u001f\u007f]/.test(env.GOOGLE_BRIDGE_TOKEN)) return null;
  try {
    const url = new URL(env.GOOGLE_BRIDGE_URL);
    if (url.origin !== "https://script.google.com" || url.username || url.password || url.search || url.hash
      || !/^\/macros\/s\/[A-Za-z0-9_-]{20,}\/exec$/.test(url.pathname)) return null;
    return { url: url.href, token: env.GOOGLE_BRIDGE_TOKEN };
  } catch { return null; }
}

export function isGoogleBridgeConfigured(env) {
  return configuration(env) !== null;
}

async function responseJson(response) {
  if (!response.ok || !/^application\/json(?:\s*;|$)/i.test(response.headers.get("content-type") ?? "")
    || Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("Google bridge response is unavailable.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Google bridge response is empty.");
  const decoder = new TextDecoder();
  let size = 0, text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        throw new Error("Google bridge response is too large.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    const result = JSON.parse(text + decoder.decode());
    if (!result || typeof result !== "object" || Array.isArray(result)) throw new Error("Google bridge response is invalid.");
    return result;
  } finally { reader.releaseLock(); }
}

export async function callGoogleBridge(env, payload, { fetcher = fetch } = {}) {
  const config = configuration(env);
  if (!config || !payload || typeof payload !== "object" || Array.isArray(payload)
    || !["expenses", "message"].includes(payload.action)) throw new Error("Google bridge is not configured for this action.");
  try {
    const body = JSON.stringify({ ...payload, token: config.token });
    if (new TextEncoder().encode(body).length > 20_000) throw new Error("Google bridge request is too large.");
    const signal = AbortSignal.timeout(12_000);
    let response = await fetcher(config.url, {
      method: "POST", redirect: "manual", cache: "no-store", signal,
      headers: { Accept: "application/json", "Content-Type": "application/json" }, body,
    });
    if ([301, 302, 303].includes(response.status)) {
      const location = response.headers.get("location");
      await response.body?.cancel();
      if (!location || location.length > 12_000) throw new Error("Google bridge redirect is invalid.");
      const redirect = new URL(location);
      if (redirect.origin !== "https://script.googleusercontent.com" || redirect.username || redirect.password || redirect.hash) throw new Error("Google bridge redirect is invalid.");
      // The initial POST has already run. ContentService serves its result from
      // a one-time Google URL. Never resend the token or message to that URL.
      response = await fetcher(redirect.href, { method: "GET", redirect: "manual", cache: "no-store", signal });
    }
    return await responseJson(response);
  } catch {
    // Transport errors can include URLs or request data. Keep these server-only
    // credentials and message contents out of returned errors.
    throw new Error("The Google bridge could not confirm its response.");
  }
}
