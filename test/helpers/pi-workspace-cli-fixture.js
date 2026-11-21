import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {Readable,Writable} from 'node:stream';
import http from 'node:http';
import {loadCoreModule} from './core-mvp-fixture.js';
import {fakePiSdk} from './pi-sdk-fixture.js';
import {projectBriefSteps} from './pi-workspace-fixture.js';
import {stubPiUpstream} from './pi-https-fixture.js';
import {piHttpRequest,piNativeResponse} from './pi-http-fixture.js';
import {createPiConformanceHttpsRequest} from '../../scripts/pi-sdk-conformance.js';
import {createPiBudgetHandler} from '../../src/pi-budget-proxy.js';
import {createPiChatHandler} from '../../src/pi-chat-server.js';
import {createPiSessionHost} from '../../src/pi-session-host.js';
import {workspaceWireToolSchemas} from '../../src/pi-workspace-protocol.js';
function wire({context}){
 const messages=[];
 for(const m of context.messages){
  if(m.role==='system')continue;
  if(m.role==='toolResult')messages.push({role:'user',content:[{type:'tool_result',tool_use_id:m.toolCallId,content:m.content,is_error:false}]});
  else messages.push({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(p=>p.type==='text'?{type:'text',text:p.text}:{type:'tool_use',id:p.id,name:p.name,input:p.arguments})});
 }
 return {model:'MiniMax-M3',stream:true,max_tokens:2048,thinking:{type:'disabled'},system:context.messages[0].content,tools:workspaceWireToolSchemas(),messages};
}
export async function createWorkspaceCliHarness(t,{cleanupFailure=false,steps=projectBriefSteps()}={}){
 let chat,budget,activeOptions,host,fake,starts=0,stops=0,requests=0;const methods=[];
 stubPiUpstream(t,async()=>{requests++;return piNativeResponse();});
 t.mock.method(globalThis,'fetch',async()=>new Response(await readFile(new URL('../../src/pi-chat.html',import.meta.url)),{headers:{'content-security-policy':"frame-ancestors 'none'"}}));
 t.mock.method(http,'request',createPiConformanceHttpsRequest(async(url,init)=>{
  const parsed=new URL(url),req=Readable.from(init.body?[Buffer.from(init.body)]:[]),chunks=[];
  Object.assign(req,{method:init.method,url:parsed.pathname,headers:{...init.headers,host:parsed.host}});
  const res=new Writable({write(chunk,_encoding,done){chunks.push(Buffer.from(chunk));done();}});res.statusCode=200;res.headersSent=false;
  res.writeHead=(status,headers)=>{res.statusCode=status;res.headers=headers;res.headersSent=true;return res;};
  await chat(req,res);return new Response(Buffer.concat(chunks),{status:res.statusCode,headers:res.headers});
 }));
 const runtime=await loadCoreModule('src/pi-native-runtime.js',{
  readBoundedNoFollowFile:async file=>{assert(file.endsWith('/never-read.env'));return Buffer.from('MINIMAX_API_KEY=synthetic-only\n');},
  startPiBudgetProxy:async options=>{budget=createPiBudgetHandler(options);return {summary:budget.summary,close:async()=>budget.close()};},
  spawn:()=>{
   starts++;const child=new EventEmitter(),pending=new Map();child.connected=true;
   const call=(method,input)=>new Promise((resolve,reject)=>{if(!child.connected)return reject(new Error('Owned channel closed'));const requestId=randomUUID();pending.set(requestId,{resolve,reject});methods.push(method);child.emit('message',{type:'call',runId:child.init.runId,requestId,method,input});});
   child.send=(message,callback)=>{
    callback?.();
    if(message.type==='result'){const waiter=pending.get(message.requestId);pending.delete(message.requestId);message.ok?waiter.resolve(message.value):waiter.reject(new Error('Owned IPC rejected'));return;}
    if(message.type==='shutdown'){void (async()=>{await host.close();stops++;child.connected=false;for(const waiter of pending.values())waiter.reject(new Error('Owned channel closed'));pending.clear();child.emit('exit',cleanupFailure&&activeOptions.workspace?1:0,null);})();return;}
    if(message.type==='init'){
     child.init=message;
     void (async()=>{
      const binding=activeOptions.planAdmission.value.nativeBinding;fake=fakePiSdk();fake.workspaceSteps(steps);
      fake.workspaceRequest(async stream=>{assert.equal((await piHttpRequest(budget,wire(stream),{'x-api-key':fake.calls.credential.at(-1).credential})).statusCode,200);});
      host=await createPiSessionHost({stateRoot:message.stateRoot,binding,sdk:fake.sdk,approvedCases:activeOptions.approvedCases,
       turnClient:{admit:input=>call('admit',input),finish:input=>call('finish',input),state:turnId=>call('state',{turnId}),status:()=>call('status',{}),workspace:sessionId=>call('workspace',{sessionId}),tool:input=>call('tool',input)}});
      chat=createPiChatHandler({host:'127.0.0.1:19492',origin:'http://127.0.0.1:19492',sessionHost:host,loginSecret:await readFile(message.loginPath,'utf8'),onStop:()=>call('stop',{})});
      child.emit('message',{type:'ready',runId:message.runId,agentId:binding.agentId,chatPort:binding.chatPort});
     })().catch(error=>child.emit('error',error));
    }
   };return child;
  }
 });
 const runner=await loadCoreModule('src/pi-cli-run.js',{startPiNative:options=>{activeOptions=options;return runtime.startPiNative(options);}});
 const cli=await loadCoreModule('src/pi-chat-cli.js',{preparePiCliRequest:runner.preparePiCliRequest,runApprovedPiCliRequest:runner.runApprovedPiCliRequest});
 return {runner,cli,stats:()=>({starts,stops,requests,methods:[...methods]})};
}
