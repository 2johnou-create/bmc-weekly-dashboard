import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import dns from "node:dns";
import worker from "../worker/index.js";
dns.setDefaultResultOrder("ipv4first");

// Local-only session key changes when this preview restarts.
const env = { ...process.env, SESSION_SECRET: process.env.SESSION_SECRET || randomBytes(48).toString("base64url") };
const host = "127.0.0.1";
const port = Number(process.env.PORT || 4182);
createServer(async (incoming, outgoing) => {
  try {
    const headers = new Headers();
    for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
    const options = { method: incoming.method, headers };
    if (!["GET", "HEAD"].includes(incoming.method)) { options.body = incoming; options.duplex = "half"; }
    const response = await worker.fetch(new Request(`http://${host}:${port}${incoming.url}`, options), env);
    outgoing.writeHead(response.status, Object.fromEntries(response.headers));
    outgoing.end(Buffer.from(await response.arrayBuffer()));
  } catch { outgoing.writeHead(500); outgoing.end("Preview could not handle the request."); }
}).listen(port, host, () => console.log(`Local: http://${host}:${port}`));
