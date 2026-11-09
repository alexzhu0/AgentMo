import { createServer } from 'node:http';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { postPiMessages } from './pi-upstream.js';
import { nativeChatModelProfile } from './native-chat-model-profile.js';

const LEGACY_POLICY = {version:1,maxRequests:16,reservationFen:31};
const INTERACTIVE_POLICY = {version:2,campaign:'course-wiki-interactive-2026-09-15',maxRequests:64,reservationFen:31};
const PROJECT_CAMPAIGN = 'course-wiki-selected-documents-v1';
const PROJECT_CAP_FEN = 10_000;
const RESERVATION_FEN = 31;
const RESERVATION_BYTES = 'reserved:31\n';
const BODY_LIMIT = 48 * 1024;
export const UPSTREAM_NETWORK_CODES = Object.freeze(['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED', 'ECONNRESET',
  'EHOSTUNREACH', 'ENETUNREACH', 'ETIMEDOUT', 'EACCES', 'EPERM', 'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_SOCKET', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'UNKNOWN', 'MULTIPLE']);
const ownData = (value, key) => { try { return Object.getOwnPropertyDescriptor(value, key)?.value; } catch { return undefined; } };
export function upstreamNetworkErrorCode(error) {
  const codes = new Set(), seen = new Set();let truncated = false;
  function visit(value, depth) {
    if (!value || typeof value !== 'object' || seen.has(value)) return;
    if (depth > 3 || seen.size >= 32) { truncated = true;return; }
    seen.add(value);
    const code = ownData(value, 'code');
    if (UPSTREAM_NETWORK_CODES.includes(code) && code !== 'UNKNOWN' && code !== 'MULTIPLE') codes.add(code);
    visit(ownData(value, 'cause'), depth + 1);
    const errors = ownData(value, 'errors');
    let count = 0;
    try { if (Array.isArray(errors)) count = ownData(errors, 'length'); } catch { truncated = true;return; }
    if (!Number.isSafeInteger(count) || count < 0) { truncated = true;return; }
    if (count > 8) truncated = true;
    for (let i=0; i<Math.min(count, 8); i++) visit(ownData(errors, String(i)), depth + 1);
  }
  visit(error, 0);
  return codes.size > 1 ? 'MULTIPLE' : codes.size === 1 && !truncated ? [...codes][0] : 'UNKNOWN';
}
function fail() { throw Object.assign(new Error('Course Wiki fee boundary refused the operation.'), {code:'COURSE_WIKI_BUDGET_REJECTED'}); }
function sha256(bytes) {return 'sha256:'+createHash('sha256').update(bytes).digest('hex');}
function isDigest(value) {return typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);}
function exactKeys(value,keys) {return value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());}

// Resolve every existing component without following symlinks, including aliases in parents.
export async function assertCoursePath(target, { absent = false } = {}) {
  if (typeof target !== 'string' || !path.isAbsolute(target) || path.normalize(target) !== target || target === '/') fail();
  const pieces=target.split(path.sep).filter(Boolean); let current='/';
  for (let i=0;i<pieces.length;i++) {
    current=path.join(current,pieces[i]);
    try { const s=await lstat(current); if(s.isSymbolicLink() || (i<pieces.length-1 && !s.isDirectory())) fail(); if(absent && i===pieces.length-1) fail(); }
    catch(error) { if(error.code==='ENOENT' && absent && i===pieces.length-1) return; throw error; }
  }
}

async function canonicalDirectory(target) {
  await assertCoursePath(target);
  const stat=await lstat(target);
  if(!stat.isDirectory()||await realpath(target)!==target)fail();
  return target;
}

function projectPolicyValid(policy) {
  return exactKeys(policy,['version','campaign','capFen','reservationFen','rootDigest','inventoryDigest','legacyBudgetCount','observedLegacyReservations','observedLegacyReservedFen','legacyCapacityReservedFen'])
    &&policy.version===3&&policy.campaign===PROJECT_CAMPAIGN&&policy.capFen===PROJECT_CAP_FEN&&policy.reservationFen===RESERVATION_FEN
    &&isDigest(policy.rootDigest)&&isDigest(policy.inventoryDigest)&&Number.isSafeInteger(policy.legacyBudgetCount)&&policy.legacyBudgetCount>0
    &&Number.isSafeInteger(policy.observedLegacyReservations)&&policy.observedLegacyReservations>=0
    &&policy.observedLegacyReservedFen===policy.observedLegacyReservations*RESERVATION_FEN
    &&Number.isSafeInteger(policy.legacyCapacityReservedFen)&&policy.legacyCapacityReservedFen>0&&policy.legacyCapacityReservedFen<=PROJECT_CAP_FEN
    &&policy.observedLegacyReservedFen<=policy.legacyCapacityReservedFen;
}

async function readPolicyState(root) {
  await assertCoursePath(root);const directory=path.join(root,'budget');await assertCoursePath(directory);
  const policyFile=path.join(directory,'campaign.json');await assertCoursePath(policyFile);
  const bytes=await readFile(policyFile);let policy;try{policy=JSON.parse(bytes);}catch{fail();}
  const legacy=[LEGACY_POLICY,INTERACTIVE_POLICY].some(candidate=>JSON.stringify(policy)===JSON.stringify(candidate));
  if(!legacy&&!projectPolicyValid(policy))fail();
  return {directory,policy,policyDigest:sha256(bytes),project:!legacy};
}

function rootDigest(root) {return sha256(`course-wiki-budget-root-v1\0${root}`);}
function referenceFor(root,state) {return {version:1,rootDigest:rootDigest(root),policyDigest:state.policyDigest,inventoryDigest:state.policy.inventoryDigest};}
function referenceMatches(actual,expected) {
  return exactKeys(actual,['version','rootDigest','policyDigest','inventoryDigest'])&&actual.version===1
    &&isDigest(actual.rootDigest)&&isDigest(actual.policyDigest)&&isDigest(actual.inventoryDigest)
    &&actual.rootDigest===expected.rootDigest&&actual.policyDigest===expected.policyDigest&&actual.inventoryDigest===expected.inventoryDigest;
}

async function slotsFor(state) {
  const {directory,policy,project}=state,pattern=project?/^slot-(\d{3})$/:/^slot-(\d{2})$/;
  const files=await readdir(directory),slots=files.flatMap(file=>{const match=pattern.exec(file);return match?[{file,index:Number(match[1])}]:[];}).sort((a,b)=>a.index-b.index);
  if(files.length!==slots.length+1)fail();
  const maximum=project?Math.floor((PROJECT_CAP_FEN-policy.legacyCapacityReservedFen)/RESERVATION_FEN):policy.maxRequests;
  if(slots.length>maximum)fail();
  for(let i=0;i<slots.length;i++){
    if(slots[i].index!==i+1)fail();
    const file=path.join(directory,slots[i].file);await assertCoursePath(file);if(await readFile(file,'utf8')!==RESERVATION_BYTES)fail();
  }
  return {count:slots.length,maximum};
}

export async function initializeCourseBudget({root,campaign}) {
  if(campaign!==undefined && campaign!==INTERACTIVE_POLICY.campaign) fail();
  const policy=campaign===INTERACTIVE_POLICY.campaign?INTERACTIVE_POLICY:LEGACY_POLICY;
  await assertCoursePath(root);
  const directory=path.join(root,'budget'); await mkdir(directory,{mode:0o700});
  const file=await open(path.join(directory,'campaign.json'),'wx',0o600);
  try { await file.writeFile(JSON.stringify(policy)); await file.sync(); } finally {await file.close();}
  await syncDirectory(directory);
}

export async function initializeCourseProjectBudget(options) {
  try {
    if(!exactKeys(options,['root','legacyRoots']))fail();
    const {root,legacyRoots}=options;await canonicalDirectory(root);
    if(!Array.isArray(legacyRoots)||!legacyRoots.length)fail();
    const canonical=[];
    for(const legacyRoot of legacyRoots)canonical.push(await canonicalDirectory(legacyRoot));
    if(new Set(canonical).size!==canonical.length||canonical.includes(root))fail();
    const all=[root,...canonical];
    for(let i=0;i<all.length;i++)for(let j=i+1;j<all.length;j++)if(all[i].startsWith(all[j]+path.sep)||all[j].startsWith(all[i]+path.sep))fail();
    const inventory=[];
    for(const legacyRoot of canonical){
      const state=await readPolicyState(legacyRoot);if(state.project)fail();
      const slots=await slotsFor(state);
      inventory.push({rootDigest:rootDigest(legacyRoot),policyDigest:state.policyDigest,observedReservations:slots.count,capacityFen:state.policy.maxRequests*state.policy.reservationFen});
    }
    inventory.sort((a,b)=>a.rootDigest<b.rootDigest?-1:a.rootDigest>b.rootDigest?1:0);
    const legacyCapacityReservedFen=inventory.reduce((sum,item)=>sum+item.capacityFen,0);if(legacyCapacityReservedFen>PROJECT_CAP_FEN)fail();
    const observedLegacyReservations=inventory.reduce((sum,item)=>sum+item.observedReservations,0);
    const policy={version:3,campaign:PROJECT_CAMPAIGN,capFen:PROJECT_CAP_FEN,reservationFen:RESERVATION_FEN,rootDigest:rootDigest(root),inventoryDigest:sha256(JSON.stringify({version:1,budgets:inventory})),legacyBudgetCount:inventory.length,observedLegacyReservations,observedLegacyReservedFen:observedLegacyReservations*RESERVATION_FEN,legacyCapacityReservedFen};
    const directory=path.join(root,'budget');await mkdir(directory,{mode:0o700});
    const file=await open(path.join(directory,'campaign.json'),'wx',0o600);
    try{await file.writeFile(JSON.stringify(policy));await file.sync();}finally{await file.close();}
    await syncDirectory(directory);
    const budgetReference=await courseBudgetReference({root});
    return {budgetReference,summary:await courseBudgetSummary({root,budgetReference})};
  } catch(error) {if(error?.code==='COURSE_WIKI_BUDGET_REJECTED')throw error;fail();}
}

export async function courseBudgetReference({root}) {
  const canonical=await canonicalDirectory(root),state=await readPolicyState(canonical);if(!state.project||state.policy.rootDigest!==rootDigest(canonical))fail();return referenceFor(canonical,state);
}

export async function validateCourseBudgetBinding({root,budgetReference}) {
  try{const expected=await courseBudgetReference({root});if(!referenceMatches(budgetReference,expected))fail();return expected;}
  catch(error){if(error?.code==='COURSE_WIKI_BUDGET_REJECTED')throw error;fail();}
}

export async function courseBudgetSummary({root,budgetReference}) {
  const state=await readPolicyState(root),{policy}=state,{count,maximum}=await slotsFor(state);
  if(!state.project){
    if(budgetReference!==undefined)fail();
    return {campaign:policy.campaign??'course-wiki-public-2026-09-14',consumedRequests:count,remainingRequests:policy.maxRequests-count,reservedCny:count*31/100,capCny:policy.version===1?5:19.84};
  }
  await canonicalDirectory(root);if(policy.rootDigest!==rootDigest(root)||!referenceMatches(budgetReference,referenceFor(root,state)))fail();
  const projectReservedFen=count*RESERVATION_FEN,totalReservedFen=policy.legacyCapacityReservedFen+projectReservedFen,remainingFen=PROJECT_CAP_FEN-totalReservedFen;
  return {campaign:policy.campaign,consumedRequests:count,remainingRequests:maximum-count,reservedCny:totalReservedFen/100,capCny:PROJECT_CAP_FEN/100,
    legacyBudgetCount:policy.legacyBudgetCount,observedLegacyReservations:policy.observedLegacyReservations,observedLegacyReservedFen:policy.observedLegacyReservedFen,
    legacyCapacityReservedFen:policy.legacyCapacityReservedFen,projectReservations:count,projectReservedFen,totalReservedFen,remainingFen,capFen:PROJECT_CAP_FEN,reservationFen:RESERVATION_FEN};
}

async function reserve(root,budgetReference) {
  const summary=await courseBudgetSummary({root,budgetReference});if(!summary.remainingRequests)fail();
  const state=await readPolicyState(root),width=state.project?3:2,maximum=state.project?summary.projectReservations+summary.remainingRequests:state.policy.maxRequests;
  // EEXIST retries only the local exclusive slot claim; provider calls are never retried.
  for(let i=1;i<=maximum;i++){
    const target=path.join(state.directory,`slot-${String(i).padStart(width,'0')}`);let fd;
    try{
      fd=openSync(target,'wx',0o600);writeFileSync(fd,RESERVATION_BYTES);fsyncSync(fd);closeSync(fd);fd=undefined;await syncDirectory(state.directory);return;
    }catch(error){
      if(fd!==undefined)closeSync(fd);
      if(error?.code!=='EEXIST')throw error;
      await assertCoursePath(target);if(await readFile(target,'utf8')!==RESERVATION_BYTES)fail();
    }
  }
  fail();
}
async function syncDirectory(directory) {const handle=await open(directory,'r');try{await handle.sync();}finally{await handle.close();}}

export function validateCourseBudgetRequest(value, modelProfile) {
  const model=nativeChatModelProfile(modelProfile);
  if(!value || typeof value!=='object' || Array.isArray(value)) fail();
  const allowed=['model','messages','max_tokens','max_completion_tokens','n','thinking','stream','stream_options','temperature','top_p',...modelProfile===undefined?[]:['service_tier']];
  if(Object.keys(value).some(k=>!allowed.includes(k)) || value.model!==model.model
    || (value.max_tokens??value.max_completion_tokens)!==2048 || (value.max_tokens!==undefined && value.max_completion_tokens!==undefined) || (value.n!==undefined && value.n!==1)
    || !(modelProfile!==undefined && !Object.hasOwn(value,'thinking')) && JSON.stringify(value.thinking)!==JSON.stringify({type:'disabled'})
    || modelProfile!==undefined && Object.hasOwn(value,'service_tier') && value.service_tier!=='standard'
    || typeof value.stream!=='boolean'
    || (value.stream_options!==undefined && JSON.stringify(value.stream_options)!==JSON.stringify({include_usage:true}))
    || !Array.isArray(value.messages) || !value.messages.length || value.messages.length>32) fail();
  for(const message of value.messages) if(!message || Object.keys(message).some(k=>!['role','content'].includes(k)) || !['system','user','assistant'].includes(message.role) || typeof message.content!=='string') fail();
  for(const field of ['temperature','top_p']) if(value[field]!==undefined && (!Number.isFinite(value[field]) || value[field]<0 || value[field]>(field==='top_p'?1:2))) fail();
}
function validUsage(usage) {return usage && Number.isSafeInteger(usage.prompt_tokens) && usage.prompt_tokens>=0 && usage.prompt_tokens<=53248 && Number.isSafeInteger(usage.completion_tokens) && usage.completion_tokens>=0 && usage.completion_tokens<=2048 && usage.total_tokens===usage.prompt_tokens+usage.completion_tokens;}
async function readBounded(stream, maximum) {const chunks=[];let size=0;for await(const chunk of stream){size+=chunk.length;if(size>maximum) fail();chunks.push(Buffer.from(chunk));}return Buffer.concat(chunks).toString('utf8');}

export function validatePiBudgetRequest(request) {
  const text = value => typeof value === 'string' && value.isWellFormed() ? value
    : Array.isArray(value) && value.length && value.every(p => exactKeys(p, ['type','text']) && p.type === 'text'
      && typeof p.text === 'string' && p.text.isWellFormed()) ? value.map(p => p.text).join('') : null;
  if (!exactKeys(request, ['model','stream','max_tokens','thinking','messages', ...Object.hasOwn(request ?? {}, 'system') ? ['system'] : []])
    || request.model !== 'MiniMax-M3' || request.stream !== true || request.max_tokens !== 2048
    || !exactKeys(request.thinking, ['type']) || request.thinking.type !== 'disabled'
    || !Array.isArray(request.messages) || !request.messages.length || request.messages.length + (request.system === undefined ? 0 : 1) > 32
    || request.messages.some(m => !exactKeys(m, ['role','content']) || !['user','assistant'].includes(m.role) || text(m.content) === null)
    || request.system !== undefined && text(request.system) === null || Buffer.byteLength(JSON.stringify(request)) > BODY_LIMIT) fail();
  const latest = request.messages.at(-1), input = text(latest.content);
  if (latest.role !== 'user' || !input.trim() || [...input].length > 8000) fail();
  return input;
}

export async function sendBudgetedCompletion({root,budgetReference,apiKey,request,deadline,signal,onReserved,onSent,modelProfile,protocol}) {
  let phase='request',upstreamStatus;const abort=new AbortController();let timer;
  const cancel=()=>abort.abort();
  try {
    if(typeof apiKey!=='string'||!apiKey||/[\r\n]/.test(apiKey)||!Number.isFinite(deadline)
      ||deadline<=Date.now()||deadline>Date.now()+120_000||signal?.aborted
      ||(onReserved!==undefined&&typeof onReserved!=='function')||(onSent!==undefined&&typeof onSent!=='function'))fail();
    const model=nativeChatModelProfile(modelProfile);
    const native = protocol === 'anthropic-messages';
    if (protocol !== undefined && !native || native && modelProfile !== 'minimax-m3-cn-v1') fail();
    if (native) validatePiBudgetRequest(request); else validateCourseBudgetRequest(request,modelProfile);
    const {max_completion_tokens:unusedMax,max_tokens:unusedLegacyMax,...normalized}=request;
    const wire=JSON.stringify(native ? request : {...normalized,[model.outputLimitKey]:2048,n:1,...modelProfile===undefined?{}:{thinking:{type:'disabled'},service_tier:'standard'}});if(Buffer.byteLength(wire)>BODY_LIMIT)fail();
    signal?.addEventListener('abort',cancel,{once:true});
    timer=setTimeout(cancel,Math.max(1,deadline-Date.now()));timer.unref();
    await reserve(root,budgetReference);await onReserved?.();
    if(abort.signal.aborted||Date.now()>=deadline)throw {code:'COURSE_WIKI_NATIVE_TIMEOUT'};
    phase='network';
    const endpoint = native ? 'https://api.minimax.cn/anthropic/v1/messages' : model.endpoint;
    const headers = native ? {'x-api-key':apiKey,'anthropic-version':'2023-06-01','content-type':'application/json'}
      : {authorization:`Bearer ${apiKey}`,'content-type':'application/json'};
    const pendingUpstream=Promise.resolve(native ? postPiMessages({body:wire,apiKey,signal:abort.signal})
      : fetch(endpoint,{method:'POST',headers,body:wire,redirect:'error',signal:abort.signal}));
    pendingUpstream.catch(()=>{});
    phase='request';
    await onSent?.();
    phase='network';
    const upstream=await pendingUpstream;
    if(Number.isInteger(upstream.status)&&upstream.status>=100&&upstream.status<=599)upstreamStatus=upstream.status;
    if(!upstream.ok){
      await upstream.body?.cancel();
      throw {code:upstream.status===429?'COURSE_WIKI_UPSTREAM_RATE_LIMIT':upstream.status>=500?'COURSE_WIKI_UPSTREAM_UNAVAILABLE':'COURSE_WIKI_UPSTREAM_DENIED'};
    }
    phase='response';const output=await readBounded(upstream.body,1024*1024);
    if (native) {
      if (upstream.headers.get('content-type')?.split(';')[0] !== 'text/event-stream') fail();
      return {body:output,contentType:'text/event-stream'};
    }
    const events=request.stream?output.split(/\r?\n/).filter(x=>x.startsWith('data: ')&&x!=='data: [DONE]').map(x=>JSON.parse(x.slice(6))):[JSON.parse(output)];
    if(events.some(event=>!event||typeof event!=='object'||Object.hasOwn(event,'error')))fail();
    if(events.some(event=>!Array.isArray(event.choices)||event.choices.length>1
      ||event.choices.some(choice=>!choice||modelProfile!==undefined&&choice.index!==0
        ||choice.finish_reason!=null&&choice.finish_reason!=='stop')))fail();
    if(events.flatMap(event=>event.choices??[]).some(choice=>[choice.message,choice.delta].some(part=>part!==undefined&&(
      !part||typeof part!=='object'||Array.isArray(part)||Object.keys(part).some(key=>!['role','content','reasoning_content'].includes(key))
      ||part.role!==undefined&&part.role!=='assistant'||part.content!=null&&typeof part.content!=='string'
      ||part.reasoning_content!=null&&part.reasoning_content!==''))))fail();
    if(events.flatMap(x=>x.choices??[]).some(choice=>[choice.message,choice.delta].some(part=>part&&(part.tool_calls!==undefined||part.function_call!==undefined))))fail();
    const last=events.findLast(x=>x.usage);if(!validUsage(last?.usage))fail();
    const finish=events.flatMap(x=>x.choices??[]).findLast(x=>x.finish_reason);
    if(finish?.finish_reason!=='stop'||(request.stream&&!output.includes('data: [DONE]')))fail();
    if(events.some(x=>x.model&&!model.responseModels.includes(x.model)))fail();
    const actualModel=events.find(x=>x.model)?.model;if(!actualModel)fail();
    return {body:output,contentType:request.stream?'text/event-stream':'application/json',actualModel,
      usage:{prompt_tokens:last.usage.prompt_tokens,completion_tokens:last.usage.completion_tokens,total_tokens:last.usage.total_tokens}};
  } catch(error) {
    const allowed=['COURSE_WIKI_NATIVE_TIMEOUT','COURSE_WIKI_UPSTREAM_RATE_LIMIT','COURSE_WIKI_UPSTREAM_UNAVAILABLE','COURSE_WIKI_UPSTREAM_DENIED'];
    const caughtCode=ownData(error,'code');
    const code=abort.signal.aborted?'COURSE_WIKI_UPSTREAM_TIMEOUT':allowed.includes(caughtCode)?caughtCode
      :phase==='network'?'COURSE_WIKI_UPSTREAM_NETWORK':phase==='response'?'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID':'COURSE_WIKI_BUDGET_REJECTED';
    throw Object.assign(new Error('Budgeted completion refused.'),{code,...upstreamStatus===undefined?{}:{upstreamStatus},
      ...code==='COURSE_WIKI_UPSTREAM_NETWORK'&&upstreamStatus===undefined?{upstreamNetworkCode:upstreamNetworkErrorCode(error)}:{}});
  } finally {clearTimeout(timer);signal?.removeEventListener('abort',cancel);abort.abort();}
}

export async function startCourseBudget({root,budgetReference,apiKey,deadline=Date.now()+90_000,onReserved}) {
  await courseBudgetSummary({root,budgetReference});
  if(typeof apiKey!=='string' || !apiKey || /[\r\n]/.test(apiKey) || !Number.isFinite(deadline) || deadline<=Date.now() || deadline>Date.now()+120_000 || (onReserved!==undefined&&typeof onReserved!=='function')) fail();
  const token=randomBytes(32).toString('hex');const abort=new AbortController();let attempted=false;let usage=null;let actualModel=null;let failure=null;let pendingUpstream=false;
  const server=createServer(async(req,res)=>{
    let ownsAttempt=false;
    try {
      if(Date.now()>=deadline || attempted || req.method!=='POST' || req.url!=='/chat/completions' || req.headers.authorization!==`Bearer ${token}` || req.headers['content-type']?.split(';')[0]!=='application/json') fail();
      const text=await readBounded(req,BODY_LIMIT); const body=JSON.parse(text);validateCourseBudgetRequest(body);
      if(attempted || Date.now()>=deadline) fail();attempted=true;ownsAttempt=true;failure=null;
      const output=await sendBudgetedCompletion({root,budgetReference,apiKey,request:body,deadline,signal:abort.signal,onReserved:()=>{pendingUpstream=true;onReserved?.();}});
      actualModel=output.actualModel;usage=output.usage;
      res.writeHead(200,{'content-type':output.contentType,'cache-control':'no-store'});res.end(output.body);
    } catch(error) {
      if(ownsAttempt||!attempted)failure??=error?.code?.startsWith('COURSE_WIKI_')?error.code:'COURSE_WIKI_BUDGET_REJECTED';
      // The legacy one-shot boundary closes its socket at the deadline, unlike the persistent native proxy.
      if(ownsAttempt&&error?.code==='COURSE_WIKI_UPSTREAM_TIMEOUT'){abort.abort();server.closeAllConnections();server.close();}
      else {if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end('{"error":{"message":"Course Wiki request refused"}}');}
    } finally {if(ownsAttempt)pendingUpstream=false;}
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const timer=setTimeout(()=>{if(pendingUpstream)failure??='COURSE_WIKI_UPSTREAM_TIMEOUT';abort.abort();server.closeAllConnections();server.close();},Math.max(1,deadline-Date.now()));timer.unref();
  return {baseUrl:`http://127.0.0.1:${server.address().port}`,token,
    summary:async()=>({...await courseBudgetSummary({root,budgetReference}),usage,actualModel,failure}),
    close:async()=>{clearTimeout(timer);abort.abort();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));apiKey='';}};
}
