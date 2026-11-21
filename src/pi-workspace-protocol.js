import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { createHash } from 'node:crypto';
import { validatePiWorkspace } from './pi-workspace-policy.js';
const validated = new WeakMap();
const hash = v => 'sha256:'+createHash('sha256').update(JSON.stringify(v)).digest('hex');
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const text=v=>typeof v==='string'?v:Array.isArray(v)&&v.every(p=>exact(p,['type','text'])&&p.type==='text'&&typeof p.text==='string')?v.map(p=>p.text).join(''):null;
export function workspaceToolSchemas(){return [
 {name:'read',description:'Read one approved source or the packaged skill.',input_schema:{type:'object',properties:{path:{type:'string'}},required:['path'],additionalProperties:false}},
 {name:'write',description:'Stage a Markdown report with source references in its body.',input_schema:{type:'object',properties:{path:{type:'string'},content:{type:'string'}},required:['path','content'],additionalProperties:false}}
];}
// Pinned M3 defaults eager streaming on; non-strict conversion strips extra schema keys.
export function workspaceWireToolSchemas(){
 return workspaceToolSchemas().map(({name,description,input_schema:schema})=>({name,description,eager_input_streaming:true,
  input_schema:{type:'object',properties:schema.properties,required:schema.required}}));
}
export function validateWorkspaceRequest({request,binding,approvedText,previousMessages,toolRecords,policy}){
 assert(validatePiWorkspace(policy).ok);
 assert(exact(request,['model','stream','max_tokens','thinking','system','tools','messages']));
 assert.equal(request.model,'MiniMax-M3');assert.equal(request.stream,true);assert.equal(request.max_tokens,2048);
 assert.deepEqual(request.thinking,{type:'disabled'});assert.deepEqual(request.tools,workspaceWireToolSchemas());
 assert.equal(text(request.system),binding.systemPrompt);assert(Buffer.byteLength(JSON.stringify(request))<=49152);
 assert(Array.isArray(request.messages)&&request.messages.length>0&&request.messages.length+1<=32);
 assert(typeof approvedText==='string'&&approvedText.trim()&&approvedText.isWellFormed()&&[...approvedText].length<=8000);
 const messages=request.messages;
 if(previousMessages===null){
  const history=binding.historyMessages??[];
  assert.deepEqual(messages.slice(0,-1),history);assert.equal(messages.at(-1).role,'user');assert.equal(text(messages.at(-1).content),approvedText);
 }else{
  assert.deepEqual(messages.slice(0,previousMessages.length),previousMessages);
  assert.equal(messages.length,previousMessages.length+2);
  assert.equal(messages.at(-2).role,'assistant');assert.equal(messages.at(-1).role,'user');
  assert(Array.isArray(messages.at(-2).content)&&messages.at(-2).content.some(p=>p.type==='tool_use'));
 }
 const calls=new Map(),finished=new Set();
 for(const m of messages){
  assert(exact(m,['role','content'])&&['user','assistant'].includes(m.role));
  if(typeof m.content==='string'){assert(m.content.isWellFormed());continue;}
  assert(Array.isArray(m.content)&&m.content.length);
  for(const p of m.content){
   if(p.type==='text'){assert(exact(p,['type','text'])&&typeof p.text==='string'&&p.text.isWellFormed());continue;}
   if(p.type==='tool_use'){
    assert.equal(m.role,'assistant');assert(exact(p,['type','id','name','input']));assert(typeof p.id==='string'&&p.id.length>0&&p.id.length<=128&&!calls.has(p.id));
    const record=toolRecords.find(r=>r.toolCallId===p.id);assert(record&&['read','write'].includes(p.name)&&record.name===p.name&&isDeepStrictEqual(record.args,p.input));calls.set(p.id,record);
   }else{
    assert.equal(m.role,'user');assert((exact(p,['type','tool_use_id','content']) || exact(p,['type','tool_use_id','content','is_error']) && p.is_error === false)&&p.type==='tool_result');
    const record=calls.get(p.tool_use_id);assert(record&&!finished.has(p.tool_use_id));
    assert.equal(text(p.content),JSON.stringify(record.result));finished.add(p.tool_use_id);
   }
  }
 }
 assert.equal(calls.size,finished.size);
 const value=Object.freeze({requestDigest:hash(request),messages:structuredClone(messages)});validated.set(value,JSON.stringify(request));return value;
}
export function isValidatedWorkspaceRequest(value,request){return validated.has(value)&&validated.get(value)===JSON.stringify(request);}

export function validateWorkspaceHistory({entries,binding,toolRecords}) {
 const pending=new Map(), seen=new Set();let unfinished=false;
 assert(Array.isArray(entries)&&Array.isArray(toolRecords));
 for(const entry of entries){
  if(entry.type!=='message')continue;
  const m=entry.message;assert(m&&['system','user','assistant','toolResult'].includes(m.role));
  if(m.role==='user'){assert.equal(pending.size,0);unfinished=true;}
  if(m.role==='assistant'){
   assert.equal(m.provider,'minimax-cn');assert.equal(m.model,'MiniMax-M3');
   if(m.rawStopReason==='end_turn'){assert(unfinished);assert.equal(m.stopReason,'stop');assert.equal(pending.size,0);unfinished=false;}
   else {assert(unfinished);assert.equal(pending.size,0);assert.equal(m.rawStopReason,'tool_use');assert.equal(m.stopReason,'toolUse');assert(m.content.some(c=>c.type==='toolCall'));}
   assert(Array.isArray(m.content));
   for(const c of m.content){
    if(c.type==='text'){assert.equal(typeof c.text,'string');continue;}
    assert.equal(c.type,'toolCall');assert(m.rawStopReason==='tool_use' && !seen.has(c.id));seen.add(c.id);
    const r=toolRecords.find(r=>r.toolCallId===c.id);assert(r&&r.sessionId===binding.sessionId&&r.snapshotDigest===binding.snapshotDigest&&r.name===c.name&&isDeepStrictEqual(r.args,c.arguments));pending.set(c.id,r);
   }
  }
  if(m.role==='toolResult'){
   const r=pending.get(m.toolCallId);assert(r&&!m.isError);assert.equal(m.toolName,r.name);assert.equal(text(m.content),JSON.stringify(r.result));pending.delete(m.toolCallId);
  }
 }
 assert.equal(pending.size,0);assert.equal(unfinished,false);
}
