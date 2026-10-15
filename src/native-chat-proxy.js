import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertCoursePath, validateCourseBudgetBinding, validateCourseBudgetRequest, sendBudgetedCompletion } from './course-wiki-budget.js';
import { validateNativeChatBinding } from './openclaw-install-plan.js';
import { writeNativeChatFile } from './native-chat-files.js';
import { nativeChatModelProfile } from './native-chat-model-profile.js';

const LIMIT=48*1024;
const digest=value=>'sha256:'+createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)
  ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
function reject(){throw Object.assign(new Error('Native chat request refused.'),{code:'AGENTMO_NATIVE_PROXY_REJECTED'});}

export function validateNativeChatRequest(value, modelProfile) {
  const model=nativeChatModelProfile(modelProfile);
  if(!value||Buffer.byteLength(JSON.stringify(value))>LIMIT||!Array.isArray(value.messages))reject();
  const messages=value.messages.map(message=>{
    if(!message||Object.keys(message).sort().join(',')!=='content,role')reject();
    let content=message.content;
    if(Array.isArray(content)){
      if(!content.length||content.some(part=>!part||Object.keys(part).sort().join(',')!=='text,type'||part.type!=='text'||typeof part.text!=='string'))reject();
      content=content.map(part=>part.text).join('\n');
    }
    return {role:message.role,content};
  });
  validateCourseBudgetRequest({...value,messages},modelProfile);
  const latest=messages.at(-1);
  if(latest?.role!=='user'||!latest.content.trim()||[...latest.content].length>8000)reject();
  const {max_completion_tokens:unusedMax,max_tokens:unusedLegacyMax,...normalized}=value;
  const request={...normalized,messages,[model.outputLimitKey]:2048,n:1,...modelProfile===undefined?{}:{thinking:{type:'disabled'},service_tier:'standard'}};
  const wire=canonical(request);if(Buffer.byteLength(wire)>LIMIT)reject();
  return {request:JSON.parse(wire),requestDigest:digest(wire)};
}

// Actual roots are passed separately; only digest-bound identities enter attempt keys.
export async function startNativeChatProxy(options) {
  if(!options||Object.keys(options).sort().join(',')!=='apiKey,binding,budgetRoot,stateRoot,token')reject();
  const {stateRoot,budgetRoot}=options;let {apiKey,token}=options;
  const binding=structuredClone(options.binding);
  if(!validateNativeChatBinding(binding)||binding.stateRootDigest!==digest(stateRoot)
    ||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)
    ||typeof apiKey!=='string'||!apiKey||/[\r\n]/.test(apiKey))reject();
  await assertCoursePath(stateRoot);
  if(await realpath(stateRoot)!==stateRoot||!((await lstat(stateRoot)).isDirectory()))reject();
  await validateCourseBudgetBinding({root:budgetRoot,budgetReference:binding.budgetReference});
  const attempts=path.join(stateRoot,'native-chat-attempts');await assertCoursePath(attempts);
  const info=await lstat(attempts);if(!info.isDirectory()||(info.mode&0o777)!==0o700)reject();
  const pending=new Set();let closed=false;
  const server=createServer(async(req,res)=>{
    const abort=new AbortController();pending.add(abort);let phase='request',status=400;
    const cancel=()=>{if(!res.writableFinished)abort.abort();};res.once('close',cancel);
    const timer=setTimeout(()=>abort.abort(),90_000);timer.unref();
    try {
      if(closed||req.method!=='POST'||req.url!=='/v1/chat/completions'||req.headers.authorization!==`Bearer ${token}`
        ||req.headers['content-type']?.split(';')[0]!=='application/json')reject();
      const chunks=[];let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>LIMIT)reject();chunks.push(chunk);}
      const text=new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
      const {request,requestDigest}=validateNativeChatRequest(JSON.parse(text),binding.modelProfile);
      if(abort.signal.aborted)reject();
      const key=digest(canonical({binding,requestDigest})).slice(7);
      phase='claim';status=409;
      // Never remove a claim: even an interrupted reservation is not permission to resend.
      await writeNativeChatFile({filePath:path.join(attempts,key),bytes:Buffer.from('attempted\n')});
      phase='upstream';status=502;
      const result=await sendBudgetedCompletion({root:budgetRoot,budgetReference:binding.budgetReference,apiKey,request,deadline:Date.now()+90_000,signal:abort.signal,modelProfile:binding.modelProfile});
      if(abort.signal.aborted)reject();
      res.writeHead(200,{'content-type':result.contentType,'cache-control':'no-store','x-should-retry':'false'});res.end(result.body);
    } catch(error) {
      const diagnostics={};
      if(phase==='upstream'){
        if(['COURSE_WIKI_NATIVE_TIMEOUT','COURSE_WIKI_UPSTREAM_TIMEOUT','COURSE_WIKI_UPSTREAM_RATE_LIMIT','COURSE_WIKI_UPSTREAM_UNAVAILABLE','COURSE_WIKI_UPSTREAM_DENIED','COURSE_WIKI_UPSTREAM_NETWORK','COURSE_WIKI_UPSTREAM_RESPONSE_INVALID','COURSE_WIKI_BUDGET_REJECTED'].includes(error?.code))diagnostics.causeCode=error.code;
        if(Number.isInteger(error?.upstreamStatus)&&error.upstreamStatus>=100&&error.upstreamStatus<=599)diagnostics.upstreamStatus=error.upstreamStatus;
      }
      if(!res.destroyed){res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-should-retry':'false'});
        res.end(JSON.stringify({error:{code:phase==='claim'?'NATIVE_CHAT_DUPLICATE_OR_UNCERTAIN':phase==='upstream'?'NATIVE_CHAT_COMPLETION_FAILED':'NATIVE_CHAT_REQUEST_INVALID',message:'Request not completed. Automatic retry is disabled.',...diagnostics}}));}
    } finally {clearTimeout(timer);pending.delete(abort);res.off('close',cancel);}
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;
  await new Promise((resolve,rejectListen)=>{server.once('error',rejectListen);server.listen(binding.proxyPort,'127.0.0.1',resolve);});
  return {port:binding.proxyPort,close:async()=>{
    if(closed)return;closed=true;for(const abort of pending)abort.abort();server.closeAllConnections();
    await new Promise(resolve=>server.close(resolve));apiKey='';token='';
  }};
}
