import {createServer} from 'node:http';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdir,readFile,writeFile,lstat} from 'node:fs/promises';
import path from 'node:path';
import {assertCoursePath} from './course-wiki-budget.js';
import {provisionCourseAgentWorkspace,runCourseGatewayRequest} from './course-wiki-openclaw.js';
import {courseFailureStatus} from './course-wiki-answer.js';

function fail(code='COURSE_WIKI_GATEWAY_REJECTED'){throw Object.assign(new Error('Course gateway refused the operation.'),{code});}
const SAFE_FAILURE_CODES=new Set([
  'COURSE_WIKI_REQUEST_INVALID','COURSE_WIKI_REQUEST_TOO_LARGE','COURSE_WIKI_DIAGNOSTIC_INVALID','COURSE_WIKI_LIVE_NOT_AUTHORIZED',
  'COURSE_WIKI_CONTEXT_MISSING','COURSE_WIKI_EVIDENCE_CONTEXT_MISSING','COURSE_WIKI_DUPLICATE_REQUEST',
  'COURSE_WIKI_WORKSPACE_INVALID','COURSE_WIKI_ALLOWANCE_EXHAUSTED','COURSE_WIKI_BUDGET_REJECTED',
  'COURSE_WIKI_CONSENT_REJECTED','COURSE_WIKI_OPERATION_BUSY',
  'COURSE_WIKI_EVIDENCE_TOO_LARGE',
  'COURSE_WIKI_MODEL_EMPTY','COURSE_WIKI_MODEL_JSON_FENCED','COURSE_WIKI_MODEL_JSON_INVALID','COURSE_WIKI_MODEL_RESPONSE_INVALID',
  'COURSE_WIKI_UPSTREAM_DENIED','COURSE_WIKI_UPSTREAM_NETWORK','COURSE_WIKI_UPSTREAM_RATE_LIMIT',
  'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID','COURSE_WIKI_UPSTREAM_TIMEOUT','COURSE_WIKI_UPSTREAM_UNAVAILABLE',
  'COURSE_WIKI_NATIVE_EXIT_FAILED','COURSE_WIKI_NATIVE_OUTPUT_INVALID','COURSE_WIKI_NATIVE_SPAWN_FAILED','COURSE_WIKI_NATIVE_TIMEOUT',
  'COURSE_WIKI_GATEWAY_REJECTED',
]);
const SAFE_COURSE_STAGES=new Set(['route','small-select','retrieved-select','answer']);
function safeCourseStageMetadata(value){
  if(!Array.isArray(value?.stageNames)||!Number.isInteger(value.providerRequestCount)||value.stageNames.length!==value.providerRequestCount
    ||value.providerRequestCount<0||value.providerRequestCount>3||value.stageNames.some(stage=>!SAFE_COURSE_STAGES.has(stage)))return {};
  return {stageNames:[...value.stageNames],providerRequestCount:value.providerRequestCount};
}

export function courseGatewayAgentSettings({stateDir}){
  if(typeof stateDir!=='string'||!path.isAbsolute(stateDir)||path.normalize(stateDir)!==stateDir||stateDir==='/')fail();
  return {path:path.join(stateDir,'agents/course-wiki/agent/settings.json'),value:{retry:{provider:{maxRetries:0}}}};
}

export function courseGatewayPatch({existing,root,stateDir,port}){
  if(![root,stateDir].every(p=>typeof p==='string'&&path.isAbsolute(p)&&path.normalize(p)===p)||!Number.isInteger(port)||port<1||port>65535)fail();
  const agent={id:'course-wiki',name:'Course Wiki · 课程资料助手',workspace:path.join(root,'workspace'),agentDir:path.join(stateDir,'agents/course-wiki/agent'),
    model:{primary:'course-wiki/deepseek-v4-flash',fallbacks:[]},skills:[],memorySearch:{enabled:false},tools:{profile:'minimal',deny:['*']},
    thinkingDefault:'off',contextInjection:'always',params:{maxTokens:2048,extra_body:{thinking:{type:'disabled'}}},
    identity:{name:'Course Wiki',emoji:'📚'}};
  const list=structuredClone(existing.agents?.list?.length?existing.agents.list:[{id:'main',default:true}]);
  const old=list.find(a=>a.id===agent.id);
  if(old&&JSON.stringify(old)!==JSON.stringify(agent))fail('COURSE_WIKI_AGENT_CONFLICT');
  const provider={api:'openai-completions',baseUrl:`http://127.0.0.1:${port}`,apiKey:{source:'file',provider:'course-wiki',id:'value'},
    models:[{id:'deepseek-v4-flash',name:'Course Wiki · DeepSeek V4 Flash',reasoning:false,input:['text'],contextWindow:65536,maxTokens:2048}]};
  const secret={source:'file',path:path.join(root,'gateway/proxy-token'),mode:'singleValue'};
  for(const [oldValue,newValue]of[[existing.models?.providers?.['course-wiki'],provider],[existing.secrets?.providers?.['course-wiki'],secret]])if(oldValue&&JSON.stringify(oldValue)!==JSON.stringify(newValue))fail('COURSE_WIKI_AGENT_CONFLICT');
  if(!old)list.push(agent);
  return {agents:{list},models:{providers:{'course-wiki':provider}},secrets:{providers:{'course-wiki':secret}}};
}

export async function prepareCourseGateway({root,liveAuthorization}){
  await provisionCourseAgentWorkspace({root,liveAuthorization});
  const directory=path.join(root,'gateway');
  for(const dir of[directory,path.join(directory,'attempts')]){try{await mkdir(dir,{mode:0o700});}catch(error){if(error.code!=='EEXIST')throw error;}await assertCoursePath(dir);if(!(await lstat(dir)).isDirectory())fail();}
  const tokenFile=path.join(directory,'proxy-token');
  try{await writeFile(tokenFile,randomBytes(32).toString('hex'),{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  await assertCoursePath(tokenFile);const stat=await lstat(tokenFile);
  if(!stat.isFile()||stat.nlink!==1||stat.size!==64||(stat.mode&0o077)!==0)fail();
  if(!/^[a-f0-9]{64}$/.test(await readFile(tokenFile,'utf8')))fail();
  return {tokenFile};
}

export async function startCourseGateway({root,liveAuthorization,apiKey,port=17893,onEvent=()=>{},diagnosticCaseId,onDiagnostic}){
  const report=event=>{try{onEvent(event);}catch{/* Diagnostics must not change request outcomes. */}};
  if(typeof apiKey!=='string'||!apiKey)fail('COURSE_WIKI_KEY_UNAVAILABLE');
  const {tokenFile}=await prepareCourseGateway({root,liveAuthorization});const token=await readFile(tokenFile,'utf8');
  const server=createServer(async(req,res)=>{
    try{
      if(req.headers.origin!==undefined||req.headers.host!==`127.0.0.1:${server.address().port}`||req.headers.authorization!==`Bearer ${token}`){res.writeHead(401,{'cache-control':'no-store','x-should-retry':'false'});res.end();return;}
      if(req.method!=='POST'||req.url!=='/chat/completions'||req.headers['content-type']?.split(';')[0]!=='application/json')fail('COURSE_WIKI_REQUEST_INVALID');
      if(Number(req.headers['content-length']??0)>48*1024)fail('COURSE_WIKI_REQUEST_INVALID');
      const chunks=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>48*1024)fail('COURSE_WIKI_REQUEST_INVALID');chunks.push(chunk);}
      let request;try{request=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{fail('COURSE_WIKI_REQUEST_INVALID');}
      const answer=await runCourseGatewayRequest({root,liveAuthorization,apiKey,request,diagnosticCaseId,onDiagnostic});
      const event={id:'course-'+randomUUID(),object:'chat.completion.chunk',created:Math.floor(Date.now()/1000),model:'deepseek-v4-flash',choices:[{index:0,delta:{role:'assistant',content:answer.text},finish_reason:'stop'}],usage:answer.usage};
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-store'});res.end(`data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`);
      report({status:'success',...safeCourseStageMetadata(answer)});
    }catch(error){const code=SAFE_FAILURE_CODES.has(error?.code)?error.code:'COURSE_WIKI_GATEWAY_REJECTED';const status=code==='COURSE_WIKI_REQUEST_TOO_LARGE'?400:courseFailureStatus(code);const type=status===429?'rate_limit_error':status<500?'invalid_request_error':'server_error';res.writeHead(status,{'content-type':'application/json','cache-control':'no-store','x-should-retry':'false'});res.end(JSON.stringify({error:{message:`课程请求未完成（${code}）；未自动重试。`,type,code}}));report({status:'failed',code,...safeCourseStageMetadata({stageNames:error?.courseWikiStageNames,providerRequestCount:error?.courseWikiProviderRequestCount})});}
  });
  server.requestTimeout=10_000;server.headersTimeout=10_000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}`,close:async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));apiKey='';}};
}
