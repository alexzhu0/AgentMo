import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm, mkdir, symlink, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as budget from '../src/course-wiki-budget.js';

const payload = { model: 'deepseek-v4-flash', messages: [{role:'user',content:'Public teaching text'}], max_tokens:2048, n:1, thinking:{type:'disabled'}, stream:false };
const response = { id:'test', model:'deepseek-v4.1-flash', choices:[{message:{role:'assistant',content:'ok'},finish_reason:'stop'}], usage:{prompt_tokens:20,completion_tokens:2,total_tokens:22} };
test('shared completion validates before reservation and sends once with bounded results',async t=>{
  assert.equal(typeof budget.sendBudgetedCompletion,'function');
  const root=await temporary(t);await budget.initializeCourseBudget({root});let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');
    assert.equal((await budget.courseBudgetSummary({root})).consumedRequests,1);
    assert.equal(JSON.parse(options.body).max_tokens,2048);
    return new Response(JSON.stringify(response));
  });
  const options={root,apiKey:'synthetic-only',request:payload,deadline:Date.now()+1000};
  await assert.rejects(budget.sendBudgetedCompletion({...options,request:{...payload,tools:[]}}));
  assert.equal(calls,0);assert.equal((await budget.courseBudgetSummary({root})).consumedRequests,0);
  const result=await budget.sendBudgetedCompletion(options);
  assert.deepEqual(result.usage,response.usage);assert.equal(result.actualModel,response.model);
  assert.equal(result.body,JSON.stringify(response));assert.equal(calls,1);
});
test('shared completion deadline and tool payloads fail closed without leaking or retrying',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});let calls=0;
  t.mock.method(globalThis,'fetch',async(_url,options)=>{
    calls++;
    if(calls===1)return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('private-timeout-detail')),{once:true}));
    return new Response(JSON.stringify({...response,choices:[{message:{role:'assistant',content:'ok',tool_calls:[{id:'unexpected'}]},finish_reason:'stop'}]}));
  });
  const options={root,apiKey:'synthetic-only',request:payload};
  const keepAlive=setTimeout(()=>{},1000);t.after(()=>clearTimeout(keepAlive));
  await assert.rejects(budget.sendBudgetedCompletion({...options,deadline:Date.now()+100}),{code:'COURSE_WIKI_UPSTREAM_TIMEOUT'});
  await assert.rejects(budget.sendBudgetedCompletion({...options,deadline:Date.now()+1000}),{code:'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID'});
  assert.equal(calls,2);assert.equal((await budget.courseBudgetSummary({root})).consumedRequests,2);
});
async function temporary(t) { const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'course-budget-'))); t.after(()=>rm(root,{recursive:true,force:true})); return root; }
async function child(root,name) {const result=path.join(root,name);await mkdir(result);return result;}
async function legacy(root,campaign,slots=0) {await budget.initializeCourseBudget({root,campaign});for(let i=1;i<=slots;i++)await writeFile(path.join(root,'budget',`slot-${String(i).padStart(2,'0')}`),'reserved:31\n',{flag:'wx',mode:0o600});}
function observeChild(process,{marker,timeoutMs=5000}={}) {
  return new Promise((resolve,reject)=>{
    let stdout='',stderr='',settled=false;
    const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(deadline);process.stdout.off('data',onStdout);process.stderr.off('data',onStderr);process.off('error',onError);process.off('exit',onExit);error?reject(error):resolve(result);};
    const onStdout=chunk=>{stdout+=chunk;if(marker&&stdout.includes(marker))finish(null,{event:'marker',stdout,stderr});};
    const onStderr=chunk=>{stderr+=chunk;};
    const onError=error=>finish(error);
    const onExit=(code,signal)=>finish(null,{event:'exit',code,signal,stdout,stderr});
    const deadline=setTimeout(()=>finish(new Error(`child timeout: ${stderr}`)),timeoutMs);
    process.stdout.setEncoding('utf8');process.stderr.setEncoding('utf8');process.stdout.on('data',onStdout);process.stderr.on('data',onStderr);process.once('error',onError);process.once('exit',onExit);
  });
}
async function terminateChild(process) {
  if(process.exitCode!==null||process.signalCode!==null)return;
  const exit=observeChild(process,{timeoutMs:1000}).catch(()=>null);process.kill('SIGKILL');await exit;
}

test('a rejected duplicate cannot replace the accepted request diagnostic',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  let started,release,calls=0;const ready=new Promise(resolve=>{started=resolve;});const held=new Promise(resolve=>{release=resolve;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(!String(url).startsWith('https:'))return original(url,options);calls++;started();await held;return new Response('invalid-private-body');});
  const b=await budget.startCourseBudget({root,apiKey:'synthetic-only'});t.after(()=>b.close());
  const accepted=post(b);await ready;
  try{assert.equal((await post(b,payload,'wrong')).status,502);}finally{release();}
  assert.equal((await accepted).status,502);
  assert.equal((await b.summary()).failure,'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID');assert.equal(calls,1);assert.equal((await b.summary()).consumedRequests,1);
});

test('the deadline is not an upstream timeout before a request or after a valid response',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>String(url).startsWith('https:')?new Response(JSON.stringify(response)):original(url,options));
  for(const send of [false,true]){
    const b=await budget.startCourseBudget({root,apiKey:'synthetic-only',deadline:Date.now()+150});
    try{if(send)assert.equal((await post(b)).status,200);await new Promise(resolve=>setTimeout(resolve,200));assert.equal((await b.summary()).failure,null);}finally{await b.close();}
  }
});

test('provider failures expose only bounded diagnostic categories and never refund',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  let scenario='network';
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https:'))return original(url,options);
    if(scenario==='network')throw new Error('private-provider-detail');
    if(scenario==='invalid')return new Response('private-provider-detail');
    return new Response('private-provider-detail',{status:Number(scenario)});
  });
  for(const [input,want]of [['network','COURSE_WIKI_UPSTREAM_NETWORK'],['429','COURSE_WIKI_UPSTREAM_RATE_LIMIT'],['503','COURSE_WIKI_UPSTREAM_UNAVAILABLE'],['401','COURSE_WIKI_UPSTREAM_DENIED'],['invalid','COURSE_WIKI_UPSTREAM_RESPONSE_INVALID']]){
    scenario=input;const b=await budget.startCourseBudget({root,apiKey:'synthetic-only'});
    try{assert.notEqual((await post(b)).status,200);const summary=await b.summary();assert.equal(summary.failure,want);assert.ok(!JSON.stringify(summary).includes('private-provider-detail'));}finally{await b.close();}
  }
  assert.equal((await budget.courseBudgetSummary({root})).consumedRequests,5);
});

test('interactive allocation permits exactly 64 reservations without resetting old campaigns',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root,campaign:'course-wiki-interactive-2026-09-15'});
  assert.equal((await budget.courseBudgetSummary({root})).remainingRequests,64);
  const original=globalThis.fetch;let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){calls++;return new Response(JSON.stringify(response));}return original(url,options);});
  for(let i=0;i<64;i++){const b=await budget.startCourseBudget({root,apiKey:'synthetic-only'});try{assert.equal((await post(b)).status,200);}finally{await b.close();}}
  const b=await budget.startCourseBudget({root,apiKey:'synthetic-only'});try{assert.notEqual((await post(b)).status,200);}finally{await b.close();}
  assert.equal(calls,64);assert.equal((await budget.courseBudgetSummary({root})).reservedCny,19.84);
  await assert.rejects(budget.initializeCourseBudget({root,campaign:'course-wiki-interactive-2026-09-15'}));
});

test('unknown budget campaigns cannot create an allocation',async t=>{
  const root=await temporary(t);await assert.rejects(budget.initializeCourseBudget({root,campaign:'arbitrary'}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  assert.deepEqual(await readdir(root),[]);
});
async function post(boundary, body=payload, token=boundary.token, suffix='/chat/completions') { return fetch(boundary.baseUrl+suffix,{method:'POST',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify(body)}); }

test('rejects authorization, models, unknown fields and oversized requests before upstream',async t=>{
  assert.equal(typeof budget.initializeCourseBudget,'function');
  const root=await temporary(t); await budget.initializeCourseBudget({root});
  const original=globalThis.fetch; let calls=0;
  t.mock.method(globalThis,'fetch',async(url, options)=>{if(String(url).startsWith('https:')) {calls++; return new Response(JSON.stringify(response));} return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'}); t.after(()=>b.close());
  for(const [body,token,suffix] of [[payload,'wrong'],[{...payload,model:'other'}], [{...payload,tools:[]}],[{...payload,messages:[{role:'user',content:'x'.repeat(49153)}]}],[payload,b.token,'/other']]) assert.notEqual((await post(b,body,token,suffix)).status,200);
  const edge={...payload,n:undefined,messages:[{role:'user',content:''}]};edge.messages[0].content='x'.repeat(49152-Buffer.byteLength(JSON.stringify(edge)));assert.equal(Buffer.byteLength(JSON.stringify(edge)),49152);assert.notEqual((await post(b,edge)).status,200);
  assert.equal(calls,0); assert.equal((await b.summary()).consumedRequests,0);
});

test('reserves before forwarding, keeps key only upstream, and never replenishes sixteen campaign slots',async t=>{
  assert.equal(typeof budget.initializeCourseBudget,'function');
  const root=await temporary(t); await budget.initializeCourseBudget({root}); const original=globalThis.fetch; let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')) {calls++; assert.equal(String(url),'https://api.deepseek.com/chat/completions'); assert.equal(options.redirect,'error'); assert.equal(options.headers.authorization,'Bearer test-only-secret'); assert.equal((await readdir(path.join(root,'budget'))).filter(x=>/^slot-/.test(x)).length,calls); return new Response(JSON.stringify(response),{headers:{'content-type':'application/json'}});} return original(url,options);});
  for(let i=0;i<16;i++){const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'}); const r=await post(b); assert.equal(r.status,200); assert.equal((await b.summary()).consumedRequests,i+1); await b.close();}
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'}); t.after(()=>b.close()); assert.notEqual((await post(b)).status,200); assert.equal(calls,16); assert.equal((await b.summary()).reservedCny,4.96);
  await assert.rejects(budget.initializeCourseBudget({root}));
});

test('missing usage and network failures consume slots and a single boundary never retries',async t=>{
  assert.equal(typeof budget.initializeCourseBudget,'function');
  const root=await temporary(t); await budget.initializeCourseBudget({root}); const original=globalThis.fetch; let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')) {calls++;return new Response(JSON.stringify({...response,usage:undefined}));} return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'}); t.after(()=>b.close()); assert.notEqual((await post(b)).status,200); assert.notEqual((await post(b)).status,200); assert.equal(calls,1); assert.equal((await b.summary()).consumedRequests,1);
});

test('refuses missing ledger, symlink roots and expired deadlines',async t=>{
  assert.equal(typeof budget.initializeCourseBudget,'function');
  const root=await temporary(t); await assert.rejects(budget.startCourseBudget({root,apiKey:'test-only-secret'}));
  await mkdir(path.join(root,'real')); await symlink(path.join(root,'real'),path.join(root,'link')); await assert.rejects(budget.initializeCourseBudget({root:path.join(root,'link')}));
  await budget.initializeCourseBudget({root}); await assert.rejects(budget.startCourseBudget({root,apiKey:'test-only-secret',deadline:Date.now()-1}));
});

test('normalizes actual native streaming wire and accepts bounded final SSE usage',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')) {const body=JSON.parse(options.body);assert.equal(body.max_tokens,2048);assert.equal(body.max_completion_tokens,undefined);return new Response(`data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`);}return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());
  assert.equal((await post(b,{...payload,max_tokens:undefined,max_completion_tokens:2048,stream:true,stream_options:{include_usage:true}})).status,200);
  assert.equal((await b.summary()).actualModel,'deepseek-v4.1-flash');
});

test('accepts canonical deepseek-flash responses without changing requested model and rejects other identities',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;let responseModel='deepseek-flash';
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){assert.equal(String(url),'https://api.deepseek.com/chat/completions');assert.equal(JSON.parse(options.body).model,'deepseek-v4-flash');return new Response(`data: ${JSON.stringify({...response,model:responseModel})}\n\ndata: [DONE]\n\n`);}return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());
  assert.equal((await post(b,{...payload,stream:true,stream_options:{include_usage:true}})).status,200);assert.equal((await b.summary()).actualModel,'deepseek-flash');assert.equal((await b.summary()).reservedCny,0.31);
  for(const model of ['deepseek-pro','other-model','deepseek-flash-extra']){responseModel=model;const rejected=await budget.startCourseBudget({root,apiKey:'test-only-secret'});try{assert.notEqual((await post(rejected,{...payload,stream:true})).status,200);}finally{await rejected.close();}}
});

test('truncated model output cannot be labelled successful even with valid usage',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>String(url).startsWith('https:')?new Response(JSON.stringify({...response,choices:[{finish_reason:'length'}]})):original(url,options));
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());assert.notEqual((await post(b)).status,200);assert.equal((await b.summary()).consumedRequests,1);
});

test('simultaneous requests and upstream failure never get a retry or a refund',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){calls++;throw new Error('synthetic-private-error');}return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());const replies=await Promise.all([post(b),post(b)]);for(const reply of replies){assert.notEqual(reply.status,200);assert.ok(!(await reply.text()).includes('synthetic-private'));}assert.equal(calls,1);assert.equal((await b.summary()).consumedRequests,1);
});

test('corrupt and missing reserved slots fail closed instead of renewing budget',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});await writeFile(path.join(root,'budget','slot-02'),'reserved:31\n');await assert.rejects(budget.courseBudgetSummary({root}));
});

test('missing actual model identity is not successful provider evidence',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>String(url).startsWith('https:')?new Response(JSON.stringify({...response,model:undefined})):original(url,options));
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());assert.notEqual((await post(b)).status,200);
});

test('the deadline aborts an in-flight upstream and retains its reserved slot',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;let calls=0;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){calls++;return new Promise((resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true}));}return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret',deadline:Date.now()+150});t.after(()=>b.close());await assert.rejects(post(b));assert.equal(calls,1);assert.equal((await b.summary()).consumedRequests,1);assert.equal((await b.summary()).failure,'COURSE_WIKI_UPSTREAM_TIMEOUT');
});

test('usage summaries retain only counters, never arbitrary provider metadata',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;
  t.mock.method(globalThis,'fetch',async(url,options)=>String(url).startsWith('https:')?new Response(JSON.stringify({...response,usage:{...response.usage,raw_payload:'must-not-leak'}})):original(url,options));
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());assert.equal((await post(b)).status,200);assert.deepEqual((await b.summary()).usage,{prompt_tokens:20,completion_tokens:2,total_tokens:22});
});

test('accepts bounded per-token SSE framing without raising the token or request limits',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;let calls=0;
  const base={id:'chatcmpl-synthetic-course-wiki-stream-overhead',object:'chat.completion.chunk',created:1789390000,model:'deepseek-flash'};
  const events=Array.from({length:600},(_,i)=>`data: ${JSON.stringify({...base,choices:[{index:0,delta:i===0?{role:'assistant',content:' word'}:{content:' word'},finish_reason:null}],usage:null})}\n\n`);
  events.push(`data: ${JSON.stringify({...base,choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:500,completion_tokens:600,total_tokens:1100}})}\n\n`,'data: [DONE]\n\n');
  const wire=events.join('');assert.ok(Buffer.byteLength(wire)>128*1024);assert.ok(Buffer.byteLength(wire)<1024*1024);
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){calls++;assert.equal(String(url),'https://api.deepseek.com/chat/completions');const request=JSON.parse(options.body);assert.equal(request.model,'deepseek-v4-flash');assert.equal(request.max_tokens,2048);assert.ok(Buffer.byteLength(options.body)<=48*1024);return new Response(new ReadableStream({start(controller){for(const event of events)controller.enqueue(Buffer.from(event));controller.close();}}),{headers:{'content-type':'text/event-stream'}});}return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());const result=await post(b,{...payload,stream:true,stream_options:{include_usage:true}});assert.equal(result.status,200);assert.equal(await result.text(),wire);assert.equal(calls,1);const summary=await b.summary();assert.deepEqual(summary.usage,{prompt_tokens:500,completion_tokens:600,total_tokens:1100});assert.equal(summary.consumedRequests,1);assert.equal(summary.reservedCny,0.31);
});

test('rejects SSE response wire larger than one MiB without refunding or retrying',async t=>{
  const root=await temporary(t);await budget.initializeCourseBudget({root});const original=globalThis.fetch;let calls=0;
  const wire=`: ${'x'.repeat(1024*1024)}\n\ndata: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`;assert.ok(Buffer.byteLength(wire)>1024*1024);
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){calls++;return new Response(wire,{headers:{'content-type':'text/event-stream'}});}return original(url,options);});
  const b=await budget.startCourseBudget({root,apiKey:'test-only-secret'});t.after(()=>b.close());assert.notEqual((await post(b,{...payload,stream:true})).status,200);assert.notEqual((await post(b,{...payload,stream:true})).status,200);assert.equal(calls,1);const summary=await b.summary();assert.equal(summary.usage,null);assert.equal(summary.consumedRequests,1);assert.equal(summary.reservedCny,0.31);
});

test('project budget reserves inventoried legacy capacity without rewriting legacy bytes',async t=>{
  assert.equal(typeof budget.initializeCourseProjectBudget,'function');
  assert.equal(typeof budget.courseBudgetReference,'function');
  assert.equal(typeof budget.validateCourseBudgetBinding,'function');
  const base=await temporary(t),oldPublic=await child(base,'old-public'),oldInteractive=await child(base,'old-interactive'),project=await child(base,'project'),other=await child(base,'other');
  await legacy(oldPublic,undefined,1);await legacy(oldInteractive,'course-wiki-interactive-2026-09-15',2);
  const oldFiles=await Promise.all([oldPublic,oldInteractive].flatMap(root=>['campaign.json',...Array.from({length:root===oldPublic?1:2},(_,i)=>`slot-${String(i+1).padStart(2,'0')}`)].map(file=>readFile(path.join(root,'budget',file)))));
  const {budgetReference,summary}=await budget.initializeCourseProjectBudget({root:project,legacyRoots:[oldInteractive,oldPublic]});
  assert.deepEqual(Object.keys(budgetReference).sort(),['inventoryDigest','policyDigest','rootDigest','version']);
  for(const digest of [budgetReference.rootDigest,budgetReference.policyDigest,budgetReference.inventoryDigest])assert.match(digest,/^sha256:[a-f0-9]{64}$/);
  assert.equal(summary.legacyBudgetCount,2);assert.equal(summary.observedLegacyReservations,3);assert.equal(summary.observedLegacyReservedFen,93);
  assert.equal(summary.legacyCapacityReservedFen,2480);assert.equal(summary.projectReservations,0);assert.equal(summary.totalReservedFen,2480);
  assert.equal(summary.remainingFen,7520);assert.equal(summary.remainingRequests,242);assert.equal(summary.capFen,10000);assert.equal(summary.reservationFen,31);
  assert.deepEqual(await budget.courseBudgetReference({root:project}),budgetReference);
  assert.deepEqual(await budget.validateCourseBudgetBinding({root:project,budgetReference}),budgetReference);
  const reordered={inventoryDigest:budgetReference.inventoryDigest,version:1,policyDigest:budgetReference.policyDigest,rootDigest:budgetReference.rootDigest};
  assert.deepEqual(await budget.validateCourseBudgetBinding({root:project,budgetReference:reordered}),budgetReference);
  await assert.rejects(budget.courseBudgetSummary({root:project}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await assert.rejects(budget.validateCourseBudgetBinding({root:project,budgetReference:{...budgetReference,policyDigest:'sha256:'+'0'.repeat(64)}}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await assert.rejects(budget.validateCourseBudgetBinding({root:other,budgetReference}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  const afterFiles=await Promise.all([oldPublic,oldInteractive].flatMap(root=>['campaign.json',...Array.from({length:root===oldPublic?1:2},(_,i)=>`slot-${String(i+1).padStart(2,'0')}`)].map(file=>readFile(path.join(root,'budget',file)))));
  assert.deepEqual(afterFiles,oldFiles);
  const policyFile=path.join(project,'budget','campaign.json'),policy=JSON.parse(await readFile(policyFile,'utf8'));
  await writeFile(policyFile,JSON.stringify({...policy,inventoryDigest:'sha256:'+'f'.repeat(64)}));
  await assert.rejects(budget.courseBudgetSummary({root:project,budgetReference}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
});

test('project budget initialization rejects absent ambiguous symlinked or reset inventory',async t=>{
  assert.equal(typeof budget.initializeCourseProjectBudget,'function');
  const base=await temporary(t),legacyRoot=await child(base,'legacy'),project=await child(base,'project');await legacy(legacyRoot);
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot],capFen:20000}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[]}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot,legacyRoot]}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[path.join(base,'absent')]}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  const link=path.join(base,'legacy-link');await symlink(legacyRoot,link);
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[link]}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[project]}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  await mkdir(path.join(project,'budget'));
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot]}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
});

test('project reservations are concurrent exclusive cumulative and never refunded',async t=>{
  assert.equal(typeof budget.initializeCourseProjectBudget,'function');
  const base=await temporary(t),legacyRoot=await child(base,'legacy'),project=await child(base,'project');await legacy(legacyRoot);
  const {budgetReference}=await budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot]});
  const original=globalThis.fetch;let calls=0,fail=false;
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(String(url).startsWith('https:')){calls++;if(fail)throw new Error('private-failure');return new Response(JSON.stringify(response));}return original(url,options);});
  const first=await budget.startCourseBudget({root:project,budgetReference,apiKey:'synthetic-only'}),second=await budget.startCourseBudget({root:project,budgetReference,apiKey:'synthetic-only'});t.after(()=>first.close());t.after(()=>second.close());
  const replies=await Promise.all([post(first),post(second)]);assert.deepEqual(replies.map(reply=>reply.status),[200,200]);
  let summary=await budget.courseBudgetSummary({root:project,budgetReference});assert.equal(summary.projectReservations,2);assert.equal(summary.totalReservedFen,558);
  fail=true;const failed=await budget.startCourseBudget({root:project,budgetReference,apiKey:'synthetic-only'});try{assert.notEqual((await post(failed)).status,200);}finally{await failed.close();}
  summary=await budget.courseBudgetSummary({root:project,budgetReference});assert.equal(summary.projectReservations,3);assert.equal(summary.totalReservedFen,589);assert.equal(calls,3);
  await assert.rejects(budget.startCourseBudget({root:project,apiKey:'synthetic-only'}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
});

test('each request boundary emits one request-local reservation signal before its provider call',async t=>{
  const base=await temporary(t),legacyRoot=await child(base,'legacy'),project=await child(base,'project');await legacy(legacyRoot);
  const {budgetReference}=await budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot]});
  const original=globalThis.fetch,events=[];let calls=0,releaseFirst,markFirstStarted;
  const firstHeld=new Promise(resolve=>{releaseFirst=resolve;}),firstStarted=new Promise(resolve=>{markFirstStarted=resolve;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https:'))return original(url,options);
    calls++;
    if(calls===1){events.push('first-upstream');markFirstStarted();await firstHeld;}
    else events.push(`upstream-${calls}`);
    return new Response(JSON.stringify(response));
  });
  const first=await budget.startCourseBudget({root:project,budgetReference,apiKey:'synthetic-only',onReserved:()=>events.push('first-reserved')});
  const second=await budget.startCourseBudget({root:project,budgetReference,apiKey:'synthetic-only',onReserved:()=>events.push('second-reserved')});
  t.after(()=>first.close());t.after(()=>second.close());
  const firstResponse=post(first);await firstStarted;
  try{
    assert.deepEqual(events,['first-reserved','first-upstream']);
    const secondResponse=await post(second);assert.equal(secondResponse.status,200);
    assert.deepEqual(events,['first-reserved','first-upstream','second-reserved','upstream-2']);
  }finally{releaseFirst();await firstResponse;}
  assert.deepEqual(events,['first-reserved','first-upstream','second-reserved','upstream-2']);
  assert.equal((await budget.courseBudgetSummary({root:project,budgetReference})).projectReservations,2);
});

test('project budget survives module reimport and cannot be initialized again',async t=>{
  assert.equal(typeof budget.initializeCourseProjectBudget,'function');
  const base=await temporary(t),legacyRoot=await child(base,'legacy'),project=await child(base,'project');await legacy(legacyRoot);
  const {budgetReference}=await budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot]});
  await assert.rejects(budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot]}));
  const restarted=await import(`../src/course-wiki-budget.js?restart=${Date.now()}`);assert.deepEqual(await restarted.courseBudgetReference({root:project}),budgetReference);
  const original=globalThis.fetch;t.mock.method(globalThis,'fetch',async(url,options)=>String(url).startsWith('https:')?new Response(JSON.stringify(response)):original(url,options));
  const boundary=await restarted.startCourseBudget({root:project,budgetReference,apiKey:'synthetic-only'});try{assert.equal((await post(boundary)).status,200);}finally{await boundary.close();}
  const summary=await restarted.courseBudgetSummary({root:project,budgetReference});assert.equal(summary.projectReservations,1);assert.equal(summary.legacyCapacityReservedFen,496);assert.equal(summary.totalReservedFen,527);
});

test('a child crash after durable reservation cannot refund reset or retry the project budget',async t=>{
  const base=await temporary(t),legacyRoot=await child(base,'legacy'),project=await child(base,'project');await legacy(legacyRoot);
  const {budgetReference}=await budget.initializeCourseProjectBudget({root:project,legacyRoots:[legacyRoot]});
  const moduleUrl=new URL('../src/course-wiki-budget.js',import.meta.url).href,reference=JSON.stringify(budgetReference);
  const crashScript=String.raw`
    const [root,reference,moduleUrl]=process.argv.slice(1),budgetReference=JSON.parse(reference),budget=await import(moduleUrl+'?crash='+Date.now()),localFetch=globalThis.fetch;
    globalThis.fetch=async(url,options)=>String(url).startsWith('https:')?(process.stdout.write('reserved\n'),new Promise(()=>{})):localFetch(url,options);
    const boundary=await budget.startCourseBudget({root,budgetReference,apiKey:'synthetic-only'});
    await localFetch(boundary.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+boundary.token,'content-type':'application/json'},body:JSON.stringify({model:'deepseek-v4-flash',messages:[{role:'user',content:'synthetic public text'}],max_tokens:2048,n:1,thinking:{type:'disabled'},stream:false})});
  `;
  const crashing=spawn(process.execPath,['--input-type=module','--eval',crashScript,project,reference,moduleUrl],{env:{},stdio:['ignore','pipe','pipe']});t.after(()=>terminateChild(crashing));
  try{
    const marker=await observeChild(crashing,{marker:'reserved\n'});assert.equal(marker.event,'marker');
    assert.equal((await budget.courseBudgetSummary({root:project,budgetReference})).projectReservations,1);
    const crashed=observeChild(crashing);assert.equal(crashing.kill('SIGKILL'),true);const result=await crashed;assert.equal(result.event,'exit');assert.equal(result.code,null);assert.equal(result.signal,'SIGKILL');assert.equal(marker.stdout.match(/reserved\n/g)?.length,1);
  }finally{await terminateChild(crashing);}

  const restartScript=String.raw`
    const [root,reference,moduleUrl]=process.argv.slice(1),budgetReference=JSON.parse(reference),budget=await import(moduleUrl+'?restart='+Date.now()),localFetch=globalThis.fetch;
    const before=await budget.courseBudgetSummary({root,budgetReference});let calls=0;
    globalThis.fetch=async(url,options)=>{if(String(url).startsWith('https:')){calls++;return new Response(JSON.stringify({model:'deepseek-flash',choices:[{finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:2,total_tokens:22}}));}return localFetch(url,options);};
    const boundary=await budget.startCourseBudget({root,budgetReference,apiKey:'synthetic-only'});
    try{const response=await localFetch(boundary.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+boundary.token,'content-type':'application/json'},body:JSON.stringify({model:'deepseek-v4-flash',messages:[{role:'user',content:'synthetic public text'}],max_tokens:2048,n:1,thinking:{type:'disabled'},stream:false})});const after=await boundary.summary();process.stdout.write(JSON.stringify({status:response.status,before,after,calls}));}finally{await boundary.close();}
  `;
  const restarted=spawn(process.execPath,['--input-type=module','--eval',restartScript,project,reference,moduleUrl],{env:{},stdio:['ignore','pipe','pipe']});t.after(()=>terminateChild(restarted));
  try{
    const completed=await observeChild(restarted);assert.equal(completed.event,'exit');assert.equal(completed.code,0,completed.stderr);assert.equal(completed.signal,null);const result=JSON.parse(completed.stdout);
    assert.equal(result.calls,1);assert.equal(result.status,200);assert.equal(result.before.projectReservations,1);assert.equal(result.before.totalReservedFen,527);assert.equal(result.after.projectReservations,2);assert.equal(result.after.totalReservedFen,558);assert.equal(result.after.remainingRequests,304);
  }finally{await terminateChild(restarted);}
});
