import { randomUUID } from 'node:crypto';
import { chmod, readFile, writeFile, appendFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';

const url = 'https://bmc-weekly-dashboard.misty-jelly-1931.chatgpt.site/api/integrations/cropster-runner';
const token = process.env.CROPSTER_RUNNER_TOKEN;
const file = process.env.RUNNER_TEMP + '/bmc-cropster-job.json';
const validId = id => typeof id === 'string' && /^[0-9a-f-]{36}$/.test(id);
const codePattern = /^(?:CROPSTER|RUNNER)_[A-Z0-9_]{1,60}$/;

async function send(payload) {
  let code = 'RUNNER_NETWORK_ERROR';
  for (let attempt=0; attempt<3; attempt++) {
    try {
      const response = await fetch(url, {
        method:'POST',redirect:'error',signal:AbortSignal.timeout(35_000),
        headers:{Authorization:'Bearer '+token,'Content-Type':'application/json',Accept:'application/json'},
        body:JSON.stringify(payload),
      });
      if (!response.ok) {
        code='RUNNER_HTTP_'+response.status;
        await response.body?.cancel();
        if (response.status < 500 && response.status !== 429) break;
      } else {
        const result=await response.json();
        if (result?.ok===true) return result;
        code='RUNNER_RESPONSE_UNVERIFIED';
      }
    } catch {}
    if (attempt<2) await delay((attempt+1)*2000);
  }
  throw new Error(code);
}

async function claim() {
  const runnerId=randomUUID();
  const {job}=await send({runnerId,action:'claim',force:process.env.CROPSTER_REFRESH_NOW==='true'});
  if (!job) {console.log('No Cropster capture is due.'); return;}
  if (!validId(job.jobId) || !/^\d{4}-\d{2}-\d{2}$/.test(job.weekStart)) throw new Error('RUNNER_INVALID_CLAIM');
  await writeFile(file,JSON.stringify({...job,runnerId}),{mode:0o600});
  await chmod(file,0o600);
  await appendFile(process.env.GITHUB_OUTPUT,'claimed=true\n');
  console.log('Claimed Cropster job '+job.jobId+' for '+job.weekStart+'.');
}

async function capture() {
  const job=JSON.parse(await readFile(file,'utf8'));
  const { createBrowserReader } = await import('./browser.mjs');
  const sendEvent=(action,data={})=>send({action,jobId:job.jobId,runnerId:job.runnerId,...data});
  const email=process.env.CROPSTER_EMAIL, password=process.env.CROPSTER_PASSWORD;
  let reader;
  let leaseLost = false;
  let heartbeatInFlight;
  const heartbeat = setInterval(() => {
    if (heartbeatInFlight) return;
    heartbeatInFlight=sendEvent('heartbeat').catch(error=>{
      if (error.message==='RUNNER_HTTP_409') {leaseLost=true;void reader?.close();}
      console.error('Cropster heartbeat could not be confirmed.');
    }).finally(()=>{heartbeatInFlight=null;});
  },60_000);
  heartbeat.unref();
  try {
    if (!email || !password) throw new Error('RUNNER_LOGIN_UNCONFIGURED');
    await sendEvent('heartbeat');
    reader=createBrowserReader({email,password,profileIds:job.profileIds,timeoutMs:28*60_000,chromiumSandbox:false});
    const result=await reader.read(job.weekStart,{
      scope:'all',
      onProgress:event=>{
        if (['complete','failed'].includes(event.state)) console.log(JSON.stringify({stage:event.stage,state:event.state,code:event.code,at:event.at}));
      },
      onCapture:async result=>{
        if (leaseLost) throw new Error('RUNNER_LEASE_LOST');
        const reply=await sendEvent('checkpoint',{result});
        console.log('Cropster checkpoint saved: '+(reply.updated || []).join(', '));
      },
    });
    if (leaseLost) throw new Error('RUNNER_LEASE_LOST');
    const reply=await sendEvent('complete',{result});
    console.log('Cropster capture saved: '+(reply.updated || []).join(', '));
  } catch (error) {
    const candidate=error?.code || error?.message;
    const code=codePattern.test(candidate || '') ? candidate : 'RUNNER_CAPTURE_FAILED';
    await sendEvent('failed',{code}).catch(()=>{});
    throw new Error(code);
  } finally {
    clearInterval(heartbeat);
    await heartbeatInFlight;
    await reader?.close();
  }
}

try {
  if (typeof token!=='string' || token.length<32 || !process.env.RUNNER_TEMP) throw new Error('RUNNER_UNCONFIGURED');
  if (process.argv[2]==='claim') await claim();
  else if (process.argv[2]==='capture') await capture();
  else if (process.argv[2]==='abandon') {
    const {jobId,runnerId}=JSON.parse(await readFile(file,'utf8'));
    await send({jobId,runnerId,action:'failed',code:'RUNNER_WORKFLOW_FAILED'});
  }
  else throw new Error('RUNNER_INVALID_COMMAND');
} catch (error) {
  console.error(codePattern.test(error?.message || '') ? error.message : 'RUNNER_UNEXPECTED_FAILURE');
  process.exitCode=1;
}
