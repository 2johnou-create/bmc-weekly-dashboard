import { dashboardWeek } from './metrics.js';

const kg = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1_000_000;
const fields = ['weekStart','fileId','fileTitle','modifiedAt','weekCommencingSerial','demandKg','brownStockRows'];
export const privateTallyTool = {
  name:'save_verified_roast_tally',
  description:'Save the current Monday’s verified Roast Tally from the roaster Google Drive connection. Read the exact dated workbook, its modification time, 1. Roast Tally!C2 and 3. Roast Planning!C18 and D6:D17. Supply twelve row values in order, using null for genuinely empty cells. Only the dashboard owner can save a reading.',
  inputSchema:{type:'object',additionalProperties:false,required:fields,properties:{
    weekStart:{type:'string'},fileId:{type:'string'},fileTitle:{type:'string'},modifiedAt:{type:'string'},
    weekCommencingSerial:{type:'integer'},demandKg:{type:'number',minimum:0,maximum:1000000},
    brownStockRows:{type:'array',minItems:12,maxItems:12,items:{anyOf:[{type:'number',minimum:0,maximum:1000000},{type:'null'}]}},
  }},
  annotations:{readOnlyHint:false,destructiveHint:false,idempotentHint:true,openWorldHint:false},
};

export async function saveVerifiedTally(db, input, now) {
  const weekStart=dashboardWeek(undefined,now).start;
  const monday=new Date(weekStart+'T00:00:00Z');
  const title='ROAST TALLY '+monday.getUTCDate()+' '+monday.toLocaleString('en-AU',{month:'short',timeZone:'UTC'}).toUpperCase()+' '+monday.getUTCFullYear();
  const serial=(monday.getTime()-Date.UTC(1899,11,30))/86_400_000;
  const modified=Date.parse(input?.modifiedAt), rows=input?.brownStockRows;
  if (!input || typeof input!=='object' || Object.keys(input).some(key=>!fields.includes(key)) ||
      input.weekStart!==weekStart || input.fileTitle!==title || input.weekCommencingSerial!==serial ||
      typeof input.fileId!=='string' || !/^[\w-]{20,100}$/.test(input.fileId) ||
      typeof input.modifiedAt!=='string' || !/T.*(?:Z|[+-]\d\d:\d\d)$/.test(input.modifiedAt) ||
      !Number.isFinite(modified) || modified>now.getTime()+120000 ||
      !kg(input.demandKg) || !Array.isArray(rows) || rows.length!==12 ||
      !rows.every(value=>value===null || kg(value))) throw new Error('Invalid weekly workbook reading.');
  const brown=rows.every(value=>value===null) ? null : Math.round(rows.reduce((sum,value)=>sum+(value??0),0)*100)/100;
  if (brown!==null && !kg(brown)) throw new Error('Invalid brown stock total.');
  const saved=await db.prepare(`INSERT INTO dashboard_private_roast_tallies
    (week_start,file_id,modified_at,checked_at,demand_kg,brown_stock_kg) VALUES (?,?,?,?,?,?)
    ON CONFLICT(week_start) DO UPDATE SET modified_at=excluded.modified_at,checked_at=excluded.checked_at,
    demand_kg=excluded.demand_kg,brown_stock_kg=excluded.brown_stock_kg
    WHERE file_id=excluded.file_id AND modified_at<=excluded.modified_at AND checked_at<=excluded.checked_at
    RETURNING checked_at`).bind(weekStart,input.fileId,modified,now.getTime(),Math.round(input.demandKg*100)/100,brown).first();
  if (!saved) throw new Error('The existing reading conflicts with this workbook or is newer.');
  return {status:'saved',weekStart,checkedAt:new Date(saved.checked_at).toISOString()};
}
