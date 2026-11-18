import { HttpError } from "./auth.js";
import { callGoogleBridge, isGoogleBridgeConfigured } from "./google-bridge.js";

const RECIPIENT = "roaster@blackmarketroasters.com.au";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/;
const encoder = new TextEncoder();

export function roasterMessagingCapability(env) {
  const available = isGoogleBridgeConfigured(env);
  return {
    available,
    recipient: RECIPIENT,
    note: available ? "" : "Sending email needs a one-time Google connection.",
  };
}

function messageInput(input) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
    Object.keys(input).some(key => !["id", "message"].includes(key))) {
    throw new HttpError("Enter a valid message.");
  }
  if (typeof input.id !== "string" || !UUID.test(input.id)) {
    throw new HttpError("Start a new message from John’s speech bubble.");
  }
  if (typeof input.message !== "string" || CONTROL_CHARACTERS.test(input.message)) {
    throw new HttpError("Enter a plain-text message.");
  }
  const message = input.message.replace(/\r\n?/g, "\n").trim();
  if (!message || message.length > 500) throw new HttpError("Use a message of 1 to 500 characters.");
  return { id: input.id.toLowerCase(), message };
}

async function messageDigest(message) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(message)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

function queued(id) {
  return { id, status: "queued", note: "Delivery has not been confirmed. Your draft remains in this form." };
}

export async function sendRoasterMessage(db, env, input, { now = Date.now(), fetcher = fetch } = {}) {
  const { id, message } = messageInput(input);
  if (!isGoogleBridgeConfigured(env)) {
    return { id, status: "unavailable", note: roasterMessagingCapability(env).note };
  }
  if (!db || typeof db.prepare !== "function") {
    throw new HttpError("Messaging could not be checked. Your text is still here.", 503);
  }
  const digest = await messageDigest(message);
  let prior;
  try {
    prior = await db.prepare(`
      INSERT INTO warehouse_roaster_messages (id, digest, status, created_at, updated_at)
      VALUES (?, ?, 'queued', ?, ?) ON CONFLICT(id) DO NOTHING
      RETURNING id, digest, status
    `).bind(id, digest, now, now).first();
    if (!prior) {
      prior = await db.prepare("SELECT id, digest, status FROM warehouse_roaster_messages WHERE id = ?")
        .bind(id).first();
    }
  } catch {
    throw new HttpError("Messaging could not be checked. Your text is still here.", 503);
  }
  if (!prior) throw new HttpError("Messaging could not be checked. Your text is still here.", 503);
  if (prior.digest !== digest) throw new HttpError("This message reference belongs to different text. Start a new message.", 409);
  if (prior.status === "sent") return { id, status: "sent" };

  let reply;
  try {
    // The bridge reserves the same UUID under a ScriptLock before calling
    // MailApp. Repeating an uncertain request can check its receipt, but it
    // cannot send an already-reserved message a second time.
    reply = await callGoogleBridge(env, { action: "message", id, message }, { fetcher });
  } catch {
    return queued(id);
  }
  if (reply.id !== id) return queued(id);
  if (reply.status === "sent") {
    try {
      await db.prepare("UPDATE warehouse_roaster_messages SET status = 'sent', updated_at = ? WHERE id = ? AND digest = ?")
        .bind(now, id, digest).run();
    } catch {
      // Google's durable receipt still prevents another send if D1 is briefly
      // unavailable after the confirmed MailApp response.
    }
    return { id, status: "sent" };
  }
  if (reply.status === "unavailable") {
    return { id, status: "unavailable", note: "Email is temporarily unavailable. Your text is still here." };
  }
  return queued(id);
}
