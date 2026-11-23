import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { zipSync, strToU8 } from '../vendor/fflate.mjs';
import { parseWeeklyDemandWorkbook } from '../worker/demand.js';

const code = await readFile(new URL('../integrations/roast-tally-mailbridge/Code.gs', import.meta.url), 'utf8');
const folder = '1rxLbvoqyaxEdRJWJeWBOwmnmDqxnHXEo';
const sourceId = '1CurrentRoastTally23Nov2026';
const xlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const sheet = 'application/vnd.google-apps.spreadsheet';
const now = new Date('2026-11-23T01:00:00.000Z');
const clone = value => JSON.parse(JSON.stringify(value));
const encoded = value => Buffer.from(value).toString('base64url');

function workbook(kg = 1800.25) {
  return Array.from(zipSync(Object.fromEntries(Object.entries({
    'xl/workbook.xml': '<workbook xmlns:r="relationships"><sheets><sheet name="3. Roast Planning" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>',
    'xl/worksheets/sheet1.xml': '<worksheet><sheetData><c r="C18"><v>' + kg + '</v></c>' +
      Array.from({length:12}, (_,i) => '<c r="D' + (i+6) + '"><v>10</v></c>').join('') + '</sheetData></worksheet>',
  }).map(([key,value]) => [key,strToU8(value)]))));
}

function message({ id = 'message-one', from = 'Black Market Coffee <info@blackmarketroasters.com.au>', subject = 'Roast Schedule - 23/11/2026',
  links = [sourceId], attachment = null, html = null } = {}) {
  const parts = [{mimeType:'text/html',body:{data:encoded(html ?? links.map(id => '<a href="https://docs.google.com/spreadsheets/d/' + id + '/edit?usp=sharing">HERE</a>').join(' '))}}];
  if (attachment) parts.push({filename:attachment.name,mimeType:attachment.mime || xlsx,body:{attachmentId:attachment.id || 'attachment-one',size:attachment.bytes.length}});
  return {id,internalDate:String(now.getTime()-60000),payload:{mimeType:'multipart/mixed',headers:[{name:'From',value:from},{name:'Subject',value:subject}],parts}};
}

function harness(options = {}) {
  const state = {
    properties:new Map(Object.entries(options.properties || {})), messages:options.messages ?? [message()],
    files:clone(options.files || []), sources:clone(options.sources || [{id:sourceId,name:'ROAST TALLY 23 NOV 2026',mimeType:sheet,parents:['outside-folder'],modifiedTime:'2026-11-23T00:00:00Z'}]),
    sourceBytes:options.sourceBytes || workbook(), attachmentBytes:options.attachmentBytes || workbook(),
    creates:[], updates:[], exports:[], deletes:[], triggerCreates:[], propertyWrites:0,
    triggers:options.triggers || [], messagesListed:0,
  };
  const blob = (value, mime, name) => {
    const bytes = Array.from(typeof value === 'string' ? Buffer.from(value) : value);
    return {getBytes:()=>bytes,getDataAsString:()=>Buffer.from(bytes).toString('utf8'),getContentType:()=>mime,getName:()=>name};
  };
  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [now.toISOString()])); }
    static now() { return now.getTime(); }
  }
  const context = vm.createContext({
    Date:Clock, Set, Number, String, Array, Object, JSON, Math, encodeURIComponent,
    PropertiesService:{getScriptProperties:()=>({getProperty:key=>state.properties.get(key) ?? null,
      setProperty:(key,value)=>{state.propertyWrites++;state.properties.set(key,value);}})},
    LockService:{getScriptLock:()=>({tryLock:()=>options.lockAvailable !== false,releaseLock:()=>{}})},
    Utilities:{DigestAlgorithm:{SHA_256:'sha256',MD5:'md5'},newBlob:blob,
      formatDate:date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Australia/Sydney',year:'numeric',month:'2-digit',day:'2-digit'}).format(date),
      computeDigest:(algorithm,value)=>Array.from(createHash(algorithm).update(Buffer.from(value)).digest()),
      base64DecodeWebSafe:value=>Array.from(Buffer.from(value,'base64url'))},
    Gmail:{Users:{getProfile:()=>({emailAddress:options.mailbox || 'roaster@blackmarketroasters.com.au'}),Messages:{
      list:(_user,params)=>{state.messagesListed++;assert.equal(params.includeSpamTrash,false);assert.ok(!params.q.includes('has:attachment'));return {messages:state.messages.map(({id})=>({id}))};},
      get:(_user,id)=>clone(state.messages.find(message=>message.id===id)),
      Attachments:{get:()=>({data:encoded(state.attachmentBytes)})},
    }}},
    Drive:{Files:{
      get:(id)=>{
        if(id===folder)return {id:folder,mimeType:'application/vnd.google-apps.folder',trashed:false,capabilities:{canAddChildren:options.folderWritable!==false}};
        const file=[...state.files,...state.sources].find(file=>file.id===id);if(!file)throw new Error('PRIVATE_DRIVE_FAILURE');return clone(file);
      },
      list:params=>{assert.equal(params.q,"'"+folder+"' in parents and trashed = false");return {files:clone(state.files.filter(file=>file.parents?.includes(folder)))};},
      create:(metadata,content)=>{
        state.creates.push({metadata:clone(metadata),bytes:content.getBytes()});
        if(options.unknownCreate==='before')throw new Error('PRIVATE_UPSTREAM_ERROR');
        const file={...clone(metadata),id:'owned-copy-'+state.creates.length};state.files.push(file);
        if(options.unknownCreate==='after')throw new Error('PRIVATE_UPSTREAM_ERROR');
        return clone(file);
      },
      update:(metadata,id,content)=>{
        state.updates.push({id,metadata:clone(metadata),bytes:content.getBytes()});
        const file=state.files.find(file=>file.id===id);assert.ok(file);Object.assign(file,clone(metadata));return clone(file);
      },
    }},
    ScriptApp:{getOAuthToken:()=>'synthetic-google-token',getProjectTriggers:()=>state.triggers,
      deleteTrigger:trigger=>state.deletes.push(trigger),
      newTrigger:handler=>({timeBased:()=>({everyMinutes:minutes=>({create:()=>{state.triggerCreates.push({handler,minutes});state.triggers.push({getHandlerFunction:()=>handler});}})})})},
    UrlFetchApp:{fetch:(url,params)=>{
      state.exports.push({url,params});assert.ok(url.startsWith('https://www.googleapis.com/drive/v3/files/'));assert.equal(params.followRedirects,false);
      assert.equal(params.headers.Authorization,'Bearer synthetic-google-token');
      return {getResponseCode:()=>options.exportStatus || 200,getAllHeaders:()=>({'Content-Type':xlsx,'Content-Length':String(state.sourceBytes.length)}),getContent:()=>state.sourceBytes};
    }},
  });
  vm.runInContext(code,context);
  return {state,call:expression=>clone(vm.runInContext(expression,context))};
}

test('mail intake requires the Roaster mailbox and writable fixed folder before reading messages', () => {
  for(const options of [{mailbox:'personal@example.com'},{folderWritable:false}]) {
    const h=harness(options),result=h.call('runRoastTallyIntake()');
    assert.equal(result.ok,false);assert.equal(h.state.messagesListed,0);assert.equal(h.state.creates.length,0);
  }
});

test('verified schedule links already in the tally folder keep the original updating source untouched', () => {
  const original={id:sourceId,name:'ROAST TALLY 23 NOV 2026',mimeType:sheet,parents:[folder]};
  const h=harness({files:[original],sources:[original]});
  const result=h.call('runRoastTallyIntake()');
  assert.equal(result.status,'checked');assert.equal(result.items[0].status,'source-already-in-folder');
  assert.equal(h.state.exports.length,0);assert.equal(h.state.creates.length,0);assert.equal(h.state.updates.length,0);
});

test('read-only preview resolves the real linked-sheet flow without changing files, properties or triggers', () => {
  const h=harness(),result=h.call('previewRoastTallyIntake()');
  assert.equal(result.items[0].status,'ready-to-import');assert.equal(h.state.creates.length,0);
  assert.equal(h.state.propertyWrites,0);assert.equal(h.state.triggerCreates.length,0);
  assert.equal(h.state.exports.length,1);
});

test('an outside-folder linked source creates one owned XLSX accepted by the actual demand parser', () => {
  const h=harness(),first=h.call('runRoastTallyIntake()');
  assert.equal(first.status,'updated');assert.equal(first.currentWeekSourcePresent,true);assert.equal(h.state.creates.length,1);
  const created=h.state.creates[0];assert.equal(created.metadata.name,'ROAST TALLY 23 NOV 2026.xlsx');
  assert.deepEqual(created.metadata.parents,[folder]);assert.equal(created.metadata.appProperties.tallySourceId,sourceId);
  assert.deepEqual(parseWeeklyDemandWorkbook(new Uint8Array(created.bytes),'2026-11-23',created.metadata.name),{kg:1800.25,brownOnHandKg:120});
  const repeat=h.call('runRoastTallyIntake()');assert.equal(repeat.items[0].status,'already-current');assert.equal(h.state.creates.length,1);
  h.state.sourceBytes=workbook(1920.5);
  const updated=h.call('runRoastTallyIntake()');assert.equal(updated.items[0].status,'updated-copy');
  assert.equal(h.state.updates.length,1);assert.equal(h.state.updates[0].id,'owned-copy-1');assert.notEqual(h.state.updates[0].id,sourceId);
  assert.deepEqual(parseWeeklyDemandWorkbook(new Uint8Array(h.state.updates[0].bytes),'2026-11-23',created.metadata.name),{kg:1920.5,brownOnHandKg:120});
});

test('unrelated client order attachments are ignored and no attachment is required for linked schedules', () => {
  const h=harness({messages:[message({attachment:{name:'Client order.xlsx',bytes:workbook()}})]});
  assert.equal(h.call('runRoastTallyIntake()').imported,1);assert.equal(h.state.creates.length,1);
  assert.equal(h.state.creates[0].metadata.appProperties.tallySourceId,sourceId);
});

test('unapproved sender, forwarded subject, fake host and subject/source week mismatch cannot publish a tally', () => {
  const source={id:sourceId,name:'ROAST TALLY 16 NOV 2026',mimeType:sheet,parents:['outside-folder']};
  for(const options of [
    {messages:[message({from:'Black Market Coffee <attacker@example.com>'})]},
    {messages:[message({subject:'Fwd: Roast Schedule - 23/11/2026'})]},
    {messages:[message({html:'<a href="https://docs.google.com.evil/spreadsheets/d/'+sourceId+'/edit">HERE</a>'})]},
    {sources:[source]},
  ]) {
    const h=harness(options);h.call('runRoastTallyIntake()');assert.equal(h.state.creates.length,0);assert.equal(h.state.updates.length,0);
  }
});

test('multiple distinct linked tallies for the same week require review without choosing or overwriting one', () => {
  const other='1OtherCurrentRoastTally23Nov2026';
  const h=harness({messages:[message({links:[sourceId,other]})],sources:[sourceId,other].map(id=>({id,name:'ROAST TALLY 23 NOV 2026',mimeType:sheet,parents:['outside']}))});
  assert.equal(h.call('runRoastTallyIntake()').status,'needs-review');assert.equal(h.state.creates.length,0);
});

test('an existing human-managed weekly source is preserved even when the linked source changes', () => {
  const h=harness({files:[{id:'human-owned-source',name:'ROAST TALLY 23 NOV 2026',mimeType:sheet,parents:[folder]}]});
  const result=h.call('runRoastTallyIntake()');assert.equal(result.status,'needs-review');
  assert.equal(h.state.creates.length,0);assert.equal(h.state.updates.length,0);
});

test('a missing current-week message remains awaiting instead of substituting the previous week', () => {
  const previous={id:sourceId,name:'ROAST TALLY 16 NOV 2026',mimeType:sheet,parents:[folder]};
  const h=harness({messages:[message({subject:'Roast Schedule - 16/11/2026'})],files:[previous],sources:[previous]});
  const result=h.call('runRoastTallyIntake()');assert.equal(result.status,'awaiting-tally');assert.equal(result.currentWeekSourcePresent,false);
  assert.equal(h.state.creates.length,0);
});

test('uncertain creates cannot create duplicates on retry, including a lost acknowledgement after success', () => {
  const before=harness({unknownCreate:'before'});
  assert.equal(before.call('runRoastTallyIntake()').status,'needs-review');
  assert.equal(before.call('runRoastTallyIntake()').items[0].safeCode,'UPLOAD_CONFIRMATION_REQUIRED');assert.equal(before.state.creates.length,1);
  const after=harness({unknownCreate:'after'});
  assert.equal(after.call('runRoastTallyIntake()').status,'needs-review');
  assert.equal(after.call('runRoastTallyIntake()').items[0].status,'already-current');assert.equal(after.state.creates.length,1);
});

test('bounded exports reject redirects and invalid data without leaking private errors', () => {
  for(const options of [{exportStatus:302},{sourceBytes:[1,2,3,4,5,6,7,8]}]) {
    const h=harness(options),result=h.call('runRoastTallyIntake()');assert.equal(result.status,'needs-review');
    assert.equal(h.state.creates.length,0);assert.doesNotMatch(JSON.stringify(result),/synthetic-google-token|PRIVATE_|https:/);
  }
});

test('explicit dated Excel attachments are deduplicated and future or non-Monday filenames are excluded', () => {
  const attachment={name:'ROAST TALLY 23 NOV 2026.xlsx',bytes:workbook()};
  const h=harness({messages:[message({links:[],attachment})]});assert.equal(h.call('runRoastTallyIntake()').imported,1);
  assert.equal(h.call('runRoastTallyIntake()').items[0].status,'already-imported');assert.equal(h.state.creates.length,1);
  for(const name of ['ROAST TALLY 30 NOV 2026.xlsx','ROAST TALLY 24 NOV 2026.xlsx','../../ROAST TALLY 23 NOV 2026.xlsx']) {
    const h=harness({messages:[message({links:[],attachment:{...attachment,name}})]});h.call('runRoastTallyIntake()');assert.equal(h.state.creates.length,0);
  }
});

test('installation keeps unrelated triggers and does not create a second intake trigger', () => {
  const other={getHandlerFunction:()=> 'someOtherTask'},own={getHandlerFunction:()=> 'runRoastTallyIntake'};
  const h=harness({triggers:[other,own,own]});const result=h.call('installRoastTallyIntake()');
  assert.equal(result.status,'already-installed');assert.equal(h.state.triggerCreates.length,0);assert.equal(h.state.deletes.length,1);assert.notEqual(h.state.deletes[0],other);
  const fresh=harness();assert.equal(fresh.call('installRoastTallyIntake()').status,'installed');
  assert.deepEqual(fresh.state.triggerCreates,[{handler:'runRoastTallyIntake',minutes:5}]);
});

test('concurrent trigger runs return busy before any read or file write', () => {
  const h=harness({lockAvailable:false});assert.equal(h.call('runRoastTallyIntake()').status,'busy');
  assert.equal(h.state.messagesListed,0);assert.equal(h.state.creates.length,0);
});
