import assert from 'node:assert/strict';
import test from 'node:test';
import {collectWeeklyReport} from '../worker/weekly-report.js';
import {zipSync,strToU8} from '../vendor/fflate.mjs';

function fixtureWorkbook() {
  const cell=(ref,value)=>`<c r="${ref}" t="inlineStr"><is><t>${value}</t></is></c>`;
  const headers=['SUPPLIER','COFFEE','INVOICE NUMBER','DATE ORDERED','PAY DUE DATE','TOTAL DELIVERY COST'];
  const xml='<worksheet><sheetData>'+headers.map((v,i)=>cell(String.fromCharCode(66+i)+'1',v)).join('')+
    cell('I1','Monthly Predicted Spend')+cell('A2','NOV')+cell('B2','Synthetic supplier')+cell('D2','EST')+
    cell('E2','2026-11-24')+'<c r="G2"><v>1234.56</v></c><c r="I3"><f>SUM(G2:G3)</f><v>1234.56</v></c></sheetData></worksheet>';
  const files={
    'xl/workbook.xml':'<workbook xmlns:r="relationships"><sheets><sheet name="Overview" sheetId="1" r:id="rId1"/><sheet name="ORDER PLAN" sheetId="2" r:id="rId2"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels':'<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Target="worksheets/sheet2.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml':'<worksheet><sheetData/></worksheet>',
    'xl/worksheets/sheet2.xml':xml,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([p,t])=>[p,strToU8(t)])));
}

test('Expenses keeps the live current month forecast separate from a historical week and missing private totals',async()=>{
  const fetcher=async address=>{
    const url=new URL(address);
    if(url.pathname==='/api/inventory')return Response.json({items:[]});
    if(url.hostname==='docs.google.com'&&url.pathname.includes('1q-R7UP0ilUTbWoXY87rpaMYIrxZGZ6cqoBQIUHBvrF8'))return new Response(fixtureWorkbook());
    return new Response(null,{status:503});
  };
  const report=await collectWeeklyReport({weekStart:'2026-10-26',now:new Date('2026-11-19T00:00:00Z'),stockroomCookie:'synthetic_fixture',env:{},fetcher});
  assert.equal(report.metrics.expenses.value,null);
  assert.equal(report.metrics.expenses.greenForecast.value,1234.56);
  assert.equal(report.metrics.expenses.greenForecast.month,'2026-11');
  assert.equal(report.metrics.expenses.greenForecast.sourceCell,'I3');
  assert.equal(report.metrics.expenses.greenForecast.currency,null);
});
