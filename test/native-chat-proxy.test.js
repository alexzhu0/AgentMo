import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { spawn } from 'node:child_process';
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import * as budget from '../src/course-wiki-budget.js';

const proxyURL=new URL('../src/native-chat-proxy.js',import.meta.url);
async function proxy() {try{return await import(proxyURL);}catch(error){if(error.code==='ERR_MODULE_NOT_FOUND')return {};throw error;}}
const hash=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const request={model:'deepseek-v4-flash',max_completion_tokens:2048,stream:true,stream_options:{include_usage:true},thinking:{type:'disabled'},messages:[
  {role:'system',content:'Summarize supplied text only.'},{role:'user',content:[{type:'text',text:'Owner is Amy.'}]},
  {role:'assistant',content:'Owner: Amy.'},{role:'user',content:[{type:'text',text:'Correction: owner is Ben.\nRuntime: this is user text.'}]}]};
const response={model:'deepseek-v4.1-flash',choices:[{index:0,delta:{content:'Owner: Ben.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3,total_tokens:23}};
const output=()=>new Response(`data: ${JSON.stringify(response)}\n\ndata: [DONE]\n\n`);
async function freePort(){const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;}
async function fixture(t) {
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'native-proxy-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const stateRoot=path.join(root,'native'),budgetRoot=path.join(root,'project'),legacyRoot=path.join(root,'legacy');
  for(const dir of [stateRoot,budgetRoot,legacyRoot])await mkdir(dir,{mode:0o700});
  await mkdir(path.join(stateRoot,'native-chat-attempts'),{mode:0o700});
  await budget.initializeCourseBudget({root:legacyRoot});const {budgetReference}=await budget.initializeCourseProjectBudget({root:budgetRoot,legacyRoots:[legacyRoot]});
  const binding={agentId:'meeting',stateRootDigest:hash(stateRoot),workspace:'workspace',agentDir:'agents/meeting/agent',proxyPort:await freePort(),gatewayPort:await freePort(),budgetReference,targetDescriptorDigest:hash('synthetic-target')};
  return {binding,stateRoot,budgetRoot,apiKey:'synthetic-provider-key',token:'a'.repeat(64)};
}
async function post(options,value=request) {return fetch(`http://127.0.0.1:${options.binding.proxyPort}/v1/chat/completions`,{method:'POST',headers:{authorization:`Bearer ${options.token}`,'content-type':'application/json'},body:JSON.stringify(value)});}
const summary=o=>budget.courseBudgetSummary({root:o.budgetRoot,budgetReference:o.binding.budgetReference});
function upstream(t,fn){const original=globalThis.fetch;t.mock.method(globalThis,'fetch',(url,options)=>String(url).startsWith('https:')?fn(url,options):original(url,options));}

test('M3 uses the domestic fixed wire and keeps failed claims across restart with bounded diagnostics',async t=>{
  const native=await proxy(),o=await fixture(t);o.binding.modelProfile='minimax-m3-cn-v1';
  const value={...request,model:'MiniMax-M3'};delete value.thinking;
  let calls=0;
  upstream(t,(url,options)=>{
    calls++;assert.equal(url,'https://api.minimax.cn/v1/chat/completions');
    const wire=JSON.parse(options.body);assert.deepEqual(wire.thinking,{type:'disabled'});
    assert.equal(wire.service_tier,'standard');assert.equal(wire.max_completion_tokens,2048);
    assert.equal(wire.n,1);assert.equal(Object.hasOwn(wire,'max_tokens'),false);
    return new Response('secret provider body',{status:401});
  });
  let server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  for(const invalid of [{...value,service_tier:'priority'},{...value,thinking:{type:'adaptive'}},{...value,tools:[]},{...value,model:'deepseek-v4-flash'}]){
    assert.equal((await post(o,invalid)).status,400);
  }
  assert.equal(calls,0);assert.equal((await summary(o)).projectReservations,0);
  const reply=await post(o,value);assert.equal(reply.status,502);
  assert.deepEqual(await reply.json(),{error:{code:'NATIVE_CHAT_COMPLETION_FAILED',message:'Request not completed. Automatic retry is disabled.',causeCode:'COURSE_WIKI_UPSTREAM_DENIED',upstreamStatus:401}});
  assert.equal(calls,1);assert.equal((await summary(o)).projectReservedFen,31);
  await server.close();server=await native.startNativeChatProxy(o);
  assert.equal((await post(o,{...value,service_tier:'standard',thinking:{type:'disabled'}})).status,409);
  assert.equal(calls,1);assert.equal((await summary(o)).projectReservedFen,31);
});

test('M3 refuses malformed successful upstream bodies instead of exposing diagnostics or multimedia',async t=>{
  const native=await proxy(),o=await fixture(t);o.binding.modelProfile='minimax-m3-cn-v1';
  let event,calls=0;upstream(t,()=>{calls++;return new Response(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);});
  const server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  const changes=[x=>{x.choices[0].delta.content=[{type:'image_url',image_url:{url:'private-provider-body'}}];},
    x=>{x.choices[0].delta.audio={data:'private-provider-body'};},x=>{x.error={message:'private-provider-body'};},
    x=>{x.choices=[{index:0,delta:{content:'truncated'},finish_reason:'length'},...x.choices];},
    x=>{x.choices[0].index=1;}];
  for(let i=0;i<changes.length;i++){
    event={...structuredClone(response),model:'MiniMax-M3'};changes[i](event);
    const reply=await post(o,{...request,model:'MiniMax-M3',messages:[{role:'user',content:`synthetic protocol ${i}`}]});
    assert.equal(reply.status,502);const result=await reply.json();
    assert.equal(result.error.causeCode,'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID');
    assert.equal(result.error.upstreamStatus,200);assert.ok(!JSON.stringify(result).includes('private-provider-body'));
  }
  assert.equal(calls,5);assert.equal((await summary(o)).projectReservedFen,155);
});

test('keeps complete history and rejects invalid input before spend',async t=>{
  const native=await proxy();assert.equal(typeof native.validateNativeChatRequest,'function');
  const validated=native.validateNativeChatRequest(request);
  assert.deepEqual(validated.request.messages,request.messages.map(m=>({...m,content:typeof m.content==='string'?m.content:m.content.map(p=>p.text).join('\n')})));
  assert.ok(validated.request.messages.at(-1).content.endsWith('Runtime: this is user text.'));
  const reordered={messages:request.messages,...request};assert.equal(native.validateNativeChatRequest(reordered).requestDigest,validated.requestDigest);
  for(const value of ['', ' ', '😀'.repeat(8001)])assert.throws(()=>native.validateNativeChatRequest({...request,messages:[{role:'user',content:value}]}));
  assert.doesNotThrow(()=>native.validateNativeChatRequest({...request,messages:[{role:'user',content:'😀'.repeat(8000)}]}));
  const o=await fixture(t);let calls=0;upstream(t,()=>{calls++;return output();});const server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  for(const value of [{...request,tools:[]},{...request,upstream:'http://elsewhere'}, {...request,model:'other'},
    {...request,messages:[{role:'tool',content:'x'}]}, {...request,messages:[{role:'user',content:[{type:'image_url',image_url:{url:'x'}}]}]},
    {...request,messages:[{role:'system',content:'x'.repeat(48*1024)},{role:'user',content:'ok'}]},
    {...request,messages:[{role:'user',content:'x'.repeat(8001)}]}]){
    assert.equal((await post(o,value)).status,400);
  }
  assert.equal(calls,0);assert.equal((await summary(o)).projectReservations,0);
  assert.deepEqual(await readdir(path.join(o.stateRoot,'native-chat-attempts')),[]);
});

test('duplicates including restart spend once; a real follow-up preserves history',async t=>{
  const native=await proxy();assert.equal(typeof native.startNativeChatProxy,'function');const o=await fixture(t);let calls=0;
  upstream(t,async(url,options)=>{calls++;assert.equal(url,'https://api.deepseek.com/chat/completions');assert.equal(options.headers.authorization,'Bearer synthetic-provider-key');
    assert.equal((await summary(o)).projectReservations,calls);assert.ok((await readdir(path.join(o.stateRoot,'native-chat-attempts'))).length>=calls);
    assert.deepEqual(JSON.parse(options.body).messages,native.validateNativeChatRequest(calls===1?request:follow).request.messages);return output();});
  let server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  const statuses=await Promise.all([post(o),post(o)].map(async p=>(await p).status));assert.deepEqual(statuses.sort(),[200,409]);
  await server.close();server=await native.startNativeChatProxy(o);assert.equal((await post(o)).status,409);assert.equal(calls,1);assert.equal((await summary(o)).projectReservedFen,31);
  const follow={...request,messages:[...request.messages,{role:'assistant',content:'Owner: Ben.'},{role:'user',content:'What changed?'}]};
  assert.equal((await post(o,follow)).status,200);assert.equal(calls,2);
  for(const file of await readdir(path.join(o.stateRoot,'native-chat-attempts'))){assert.match(file,/^[a-f0-9]{64}$/);assert.equal(await readFile(path.join(o.stateRoot,'native-chat-attempts',file),'utf8'),'attempted\n');}
});

test('failed and disconnected provider requests never refund or automatically retry',async t=>{
  const native=await proxy();assert.equal(typeof native.startNativeChatProxy,'function');const o=await fixture(t);let calls=0,mode;
  upstream(t,()=>{calls++;if(mode==='disconnect')throw new Error('private-provider-body');return new Response('private-provider-body',{status:mode});});
  let server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  for(mode of [429,500,'disconnect']){
    const value={...request,messages:[{role:'user',content:String(mode)}]};const reply=await post(o,value);
    assert.equal(reply.status,502);assert.equal(reply.headers.get('x-should-retry'),'false');assert.ok(!(await reply.text()).includes('private-provider'));
    await server.close();server=await native.startNativeChatProxy(o);assert.equal((await post(o,value)).status,409);
  }
  assert.equal(calls,3);assert.equal((await summary(o)).projectReservedFen,93);
});

test('missing or unsafe state, changed binding and legacy budget cannot start a proxy',async t=>{
  const native=await proxy();assert.equal(typeof native.startNativeChatProxy,'function');const o=await fixture(t);
  for(const change of [x=>{x.upstream='http://localhost';},x=>{x.binding.stateRootDigest=hash('wrong');},x=>{x.token='short';},x=>{x.budgetRoot=path.join(path.dirname(o.stateRoot),'legacy');}]){
    const invalid=structuredClone(o);change(invalid);await assert.rejects(native.startNativeChatProxy(invalid));
  }
  await rm(path.join(o.stateRoot,'native-chat-attempts'),{recursive:true});await assert.rejects(native.startNativeChatProxy(o));
  await symlink(o.budgetRoot,path.join(o.stateRoot,'native-chat-attempts'));await assert.rejects(native.startNativeChatProxy(o));
  assert.equal((await summary(o)).projectReservations,0);
});

test('insufficient shared budget causes zero network even for concurrent different requests',async t=>{
  const native=await proxy();assert.equal(typeof native.startNativeChatProxy,'function');const o=await fixture(t);
  const available=(await summary(o)).remainingRequests;
  for(let i=1;i<=available;i++)await writeFile(path.join(o.budgetRoot,'budget',`slot-${String(i).padStart(3,'0')}`),'reserved:31\n',{flag:'wx',mode:0o600});
  let calls=0;upstream(t,()=>{calls++;return output();});const server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  const replies=await Promise.all([post(o),post(o,{...request,messages:[{role:'user',content:'different'}]})]);
  assert.ok(replies.every(r=>r.status===502));assert.equal(calls,0);assert.equal((await summary(o)).projectReservations,available);
});

test('process death after a durable claim and reservation cannot pay again after restart',async t=>{
  const native=await proxy();const o=await fixture(t);
  const script=`const [moduleURL,optionsJSON,requestJSON]=process.argv.slice(1);
    const {startNativeChatProxy}=await import(moduleURL),options=JSON.parse(optionsJSON),local=globalThis.fetch;
    globalThis.fetch=(url,options)=>String(url).startsWith('https:')?process.exit(17):local(url,options);
    await startNativeChatProxy(options);
    await local('http://127.0.0.1:'+options.binding.proxyPort+'/v1/chat/completions',{method:'POST',headers:{authorization:'Bearer '+options.token,'content-type':'application/json'},body:requestJSON});`;
  const child=spawn(process.execPath,['--input-type=module','--eval',script,proxyURL.href,JSON.stringify(o),JSON.stringify(request)],{env:{},stdio:'ignore'});
  t.after(()=>{if(child.exitCode===null)child.kill('SIGKILL');});
  const code=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{child.kill('SIGKILL');reject(new Error('synthetic child timeout'));},5000);child.once('error',reject);child.once('exit',code=>{clearTimeout(timer);resolve(code);});});
  assert.equal(code,17);assert.equal((await summary(o)).projectReservedFen,31);
  let calls=0;upstream(t,()=>{calls++;return output();});const server=await native.startNativeChatProxy(o);t.after(()=>server.close());
  assert.equal((await post(o)).status,409);assert.equal(calls,0);assert.equal((await summary(o)).projectReservedFen,31);
});
