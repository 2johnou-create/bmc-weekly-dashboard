import { coordinateDashboardSync } from './source-coordinator.js';
import { dashboardWeek, validDate, mondayOf } from './metrics.js';

// Sites verifies MCP identity before forwarding these headers. Public dashboard
// access alone must never allow another viewer to run the owner's source reader.
const OWNER_EMAIL = '2johnou@gmail.com';
const versions = ['2026-07-28', '2025-06-18', '2024-11-05'];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const response = (value, status = 200) => Response.json(value, {status, headers: {
  'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
}});
const tools = [
  {name: 'refresh_dashboard_sources', description: 'Start or join the current-week dashboard source update when it is due. Wakes the free Cropster website reader and saves verified source readings. Returns progress only; no business values. Only the dashboard owner can run this tool.',
    inputSchema: {type:'object', properties:{}, additionalProperties:false},
    annotations: {readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:true}},
  {name: 'check_dashboard_sync', description: 'Advance and check a saved dashboard update. Reuse its jobId and weekStart until status is complete or failed. Completed results remain available after the temporary reader record expires. Returns progress only.',
    inputSchema: {type:'object', properties:{jobId:{type:'string', pattern:uuid.source}, weekStart:{type:'string', pattern:'^20[0-9]{2}-[0-9]{2}-[0-9]{2}$'}}, required:['jobId'], additionalProperties:false},
    annotations: {readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:true}},
];

async function inputJson(request) {
  if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') || '')) throw new Error();
  if (Number(request.headers.get('content-length')) > 4096) throw new Error();
  const reader = request.body?.getReader();
  if (!reader) throw new Error();
  const decoder = new TextDecoder();
  let count = 0, text = '';
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      count += part.value.byteLength;
      if (count > 4096) {await reader.cancel(); throw new Error();}
      text += decoder.decode(part.value, {stream:true});
    }
    return JSON.parse(text + decoder.decode());
  } finally {reader.releaseLock();}
}

function metadata(value) {
  if (!plain(value) || !['running','complete','failed','archive','not-connected'].includes(value.status)) throw new Error();
  const result = {status:value.status};
  if (typeof value.jobId === 'string' && uuid.test(value.jobId)) result.jobId = value.jobId;
  if (validDate(value.weekStart)) result.weekStart = value.weekStart;
  for (const key of ['note','phase']) {
    if (typeof value[key] === 'string') result[key] = value[key].replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, key === 'note' ? 600 : 80);
  }
  if (/^[A-Z][A-Z0-9_]{0,79}$/.test(value.safeCode || '')) result.safeCode = value.safeCode;
  if (Number.isSafeInteger(value.retryAfterMs) && value.retryAfterMs >= 0 && value.retryAfterMs <= Number.MAX_SAFE_INTEGER) result.retryAfterMs = value.retryAfterMs;
  return result;
}

export async function handleDashboardMcp(request, env, {coordinate = coordinateDashboardSync, now = new Date()} = {}) {
  if (request.method !== 'POST') return response({error:'Use the authenticated MCP connection.'}, 405);
  let input;
  try {input = await inputJson(request);} catch {return response({jsonrpc:'2.0', id:null, error:{code:-32700,message:'Invalid MCP request.'}}, 400);}
  const id = typeof input?.id === 'string' || Number.isFinite(input?.id) ? input.id : null;
  const fail = (code, message, status = 200) => response({jsonrpc:'2.0', id, error:{code,message}}, status);
  const ok = result => response({jsonrpc:'2.0', id, result});
  if (!plain(input) || input.jsonrpc !== '2.0' || typeof input.method !== 'string') return fail(-32600,'Invalid MCP request.',400);
  if (input.method === 'server/discover') return ok({supportedVersions:versions, capabilities:{tools:{}}, serverInfo:{name:'BMC Weekly Dashboard',version:'42'}});
  if (input.method === 'initialize') return ok({protocolVersion:versions.includes(input.params?.protocolVersion) ? input.params.protocolVersion : versions[0], capabilities:{tools:{}}, serverInfo:{name:'BMC Weekly Dashboard',version:'42'}});
  if (input.method === 'notifications/initialized') return new Response(null,{status:204});
  if (input.method === 'ping') return ok({});
  if (input.method === 'tools/list') return ok({tools});
  if (input.method !== 'tools/call') return fail(-32601,'Unsupported MCP method.');
  const owner = request.headers.get('oai-authenticated-user-email');
  if (!owner || owner.trim().toLowerCase() !== OWNER_EMAIL) return fail(-32001,'Only the dashboard owner can run source updates.',403);
  if (id === null || !plain(input.params) || !tools.some(tool=>tool.name===input.params.name)) return fail(-32602,'Choose a supported source-update tool.');
  const args = input.params.arguments ?? {};
  const check = input.params.name === 'check_dashboard_sync';
  if (!plain(args) || Object.keys(args).some(key=>!(check ? ['jobId','weekStart'] : []).includes(key)) ||
    check && !uuid.test(args.jobId || '') || args.weekStart !== undefined && (!validDate(args.weekStart) || mondayOf(args.weekStart) !== args.weekStart)) return fail(-32602,'Enter a valid saved update reference.');
  const current = dashboardWeek(undefined,now);
  if (args.weekStart > current.start) return fail(-32602,'Choose this week or an earlier reporting week.');
  try {
    const result = metadata(await coordinate({env, weekStart:args.weekStart || current.start, ...(check ? {jobId:args.jobId} : {mode:'auto'}), now}));
    return ok({content:[{type:'text',text:JSON.stringify(result)}],structuredContent:result,...(result.status==='failed' ? {isError:true} : {})});
  } catch {
    return ok({content:[{type:'text',text:'The dashboard update could not be checked. No completion is confirmed.'}],isError:true});
  }
}
