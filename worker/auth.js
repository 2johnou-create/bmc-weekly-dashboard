const STOCKROOM = "https://bmc-stockroom.misty-jelly-1931.chatgpt.site";
const COOKIE = "bmc_weekly_session";
const MAX_AGE = 12 * 60 * 60;
const encoder = new TextEncoder();
const attempts = new Map();

export class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function base64(bytes) { return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""); }
function unbase64(value) { return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0)); }
async function sessionKey(env) {
  if (typeof env.SESSION_SECRET !== "string" || env.SESSION_SECRET.length < 32) throw new HttpError("Dashboard sign-in is being configured. Please try again shortly.", 503);
  return crypto.subtle.importKey("raw", await crypto.subtle.digest("SHA-256", encoder.encode(env.SESSION_SECRET)), "AES-GCM", false, ["encrypt", "decrypt"]);
}
function cookieValue(request) {
  return request.headers.get("cookie")?.split(";").map(v => v.trim()).find(v => v.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1) || "";
}
function cookie(request, value, maxAge) {
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}
export function clearCookie(request) { return cookie(request, "", 0); }
export function requireOrigin(request) {
  if (request.headers.get("origin") !== new URL(request.url).origin) throw new HttpError("Please use this dashboard to sign in or out.", 403);
}
export async function readSession(request, env, now = Date.now()) {
  const encoded = cookieValue(request);
  if (!encoded || encoded.length > 4096) return null;
  const key = await sessionKey(env);
  try {
    const bytes = unbase64(encoded);
    if (bytes.length < 29) return null;
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes.slice(0, 12), additionalData: encoder.encode(new URL(request.url).origin) }, key, bytes.slice(12));
    const data = JSON.parse(new TextDecoder().decode(plaintext));
    if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.expiresAt > now + MAX_AGE * 1000 || !/^bmc_stockroom_session=[A-Za-z0-9_-]{16,256}$/.test(data.stockroomCookie)) return null;
    return data;
  } catch { return null; }
}
export async function sealSession(request, env, stockroomCookie, now = Date.now()) {
  const key = await sessionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: encoder.encode(new URL(request.url).origin) }, key,
    encoder.encode(JSON.stringify({ stockroomCookie, expiresAt: now + MAX_AGE * 1000 }))));
  const bytes = new Uint8Array(iv.length + encrypted.length); bytes.set(iv); bytes.set(encrypted, iv.length);
  return cookie(request, base64(bytes), MAX_AGE);
}
async function readBody(request) {
  if (!request.headers.get("content-type")?.startsWith("application/json") || Number(request.headers.get("content-length")) > 1024 || !request.body) throw new HttpError("Enter your Stockroom password.");
  const reader = request.body.getReader(); let total = 0; const chunks = [];
  while (true) { const {done,value} = await reader.read(); if (done) break; total += value.length; if (total > 1024) { await reader.cancel(); throw new HttpError("Enter your Stockroom password."); } chunks.push(value); }
  const bytes = new Uint8Array(total); let offset = 0; for (const c of chunks) {bytes.set(c, offset);offset += c.length;}
  try { const data = JSON.parse(new TextDecoder().decode(bytes)); if (typeof data.password !== "string" || !data.password.length || data.password.length > 256) throw new Error(); return data.password; }
  catch { throw new HttpError("Enter your Stockroom password."); }
}
export async function signIn(request, env, fetcher = fetch) {
  requireOrigin(request);
  await sessionKey(env);
  const password = await readBody(request);
  const now = Date.now();
  const ip = request.headers.get("cf-connecting-ip") || "local";
  const entry = attempts.get(ip);
  if (entry && entry.until > now && entry.count >= 8) throw new HttpError("Too many sign-in attempts. Please try again in 15 minutes.", 429);
  if (attempts.size >= 2048) { for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key); if (attempts.size >= 2048) attempts.delete(attempts.keys().next().value); }
  attempts.set(ip, { count: entry && entry.until > now ? entry.count + 1 : 1, until: entry && entry.until > now ? entry.until : now + 15 * 60 * 1000 });
  let response;
  try { response = await fetcher(STOCKROOM + "/api/auth/login", { method: "POST", redirect: "manual", headers: { "Content-Type": "application/json", Origin: STOCKROOM }, body: JSON.stringify({password}), signal: AbortSignal.timeout(20000) }); }
  catch { throw new HttpError("Stockroom sign-in is temporarily unavailable. Please try again.", 503); }
  if (response.status === 401) throw new HttpError("Incorrect Stockroom password. Please try again.", 401);
  if (!response.ok) throw new HttpError("Stockroom sign-in is temporarily unavailable. Please try again.", 503);
  const token = response.headers.get("set-cookie")?.match(/(?:^|,\s*)bmc_stockroom_session=([A-Za-z0-9_-]{16,256})(?:[;,\s]|$)/)?.[1];
  if (!token) throw new HttpError("Stockroom did not return a staff session. Please try again.", 503);
  attempts.delete(ip);
  return sealSession(request, env, `bmc_stockroom_session=${token}`);
}
export async function signOut(request, env, fetcher = fetch) {
  requireOrigin(request);
  const session = await readSession(request, env);
  if (session) {
    let response;
    try { response = await fetcher(STOCKROOM + "/api/auth/logout", { method: "POST", redirect: "manual", headers: { Cookie: session.stockroomCookie, Origin: STOCKROOM }, signal: AbortSignal.timeout(12000) }); }
    catch { throw new HttpError("Sign-out could not reach Stockroom. Please try again.", 503); }
    if (!response.ok) throw new HttpError("Sign-out could not reach Stockroom. Please try again.", 503);
  }
  return clearCookie(request);
}
