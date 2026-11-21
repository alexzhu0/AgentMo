import assert from 'node:assert/strict';import test from 'node:test';
import {workspacePolicy} from './helpers/pi-workspace-fixture.js';
const policy=workspacePolicy();
const binding={systemPrompt:'Approved system',sessionId:'session',snapshotDigest:'snapshot'};
async function api(){return import('../src/pi-workspace-protocol.js');}
function wire(tools,messages=[{role:'user',content:'Make report'}]){return{model:'MiniMax-M3',stream:true,max_tokens:2048,thinking:{type:'disabled'},system:binding.systemPrompt,tools,messages};}
test('pinned SDK eager tool input flag is required and remains exact',async()=>{
 const a=await api();
 const tools=a.workspaceWireToolSchemas().map(t=>({...t,eager_input_streaming:true}));
 const args={request:wire(tools),binding,approvedText:'Make report',previousMessages:null,toolRecords:[],policy};
 assert(a.validateWorkspaceRequest(args));
 for(const patch of [{eager_input_streaming:false},{unexpected:true}]){
  const changed=structuredClone(args);Object.assign(changed.request.tools[0],patch);
  assert.throws(()=>a.validateWorkspaceRequest(changed));
 }
 const missing=structuredClone(args);delete missing.request.tools[0].eager_input_streaming;
 assert.throws(()=>a.validateWorkspaceRequest(missing));
});
test('workspace first wire binds task text, system and exact schemas before spending',async()=>{
 const a=await api(),request=wire(a.workspaceWireToolSchemas());
 const args={request,binding,approvedText:'Make report',previousMessages:null,toolRecords:[],policy};
 assert.match(a.validateWorkspaceRequest(args).requestDigest,/^sha256:/);
 for(const patch of [{system:'other'},{messages:[{role:'user',content:'different'}]},{tools:[]},{max_tokens:4096},{messages:Array(33).fill({role:'user',content:'Make report'})}])assert.throws(()=>a.validateWorkspaceRequest({...args,request:{...request,...patch}}));
});
test('followup wire accepts only exact executed tool results and prior prefix',async()=>{
 const a=await api(),first=wire(a.workspaceWireToolSchemas()),result={sourceId:'source-1',text:'evidence'},record={toolCallId:'call1',name:'read',args:{path:'sources/1.md'},result};
 const messages=[...first.messages,{role:'assistant',content:[{type:'tool_use',id:'call1',name:'read',input:record.args}]},{role:'user',content:[{type:'tool_result',tool_use_id:'call1',content:JSON.stringify(result)}]}];
 const args={request:wire(a.workspaceWireToolSchemas(),messages),binding,approvedText:'Make report',previousMessages:first.messages,toolRecords:[record],policy};
 assert(a.validateWorkspaceRequest(args));
 assert.throws(()=>a.validateWorkspaceRequest({...args,toolRecords:[]}));
 const bad=structuredClone(args);bad.request.messages.at(-1).content[0].content='forged';assert.throws(()=>a.validateWorkspaceRequest(bad));
 const changed=structuredClone(args);changed.request.messages=structuredClone(changed.request.messages);changed.request.messages[0].content='changed';assert.throws(()=>a.validateWorkspaceRequest(changed));
});
test('workspace wire rejects duplicate calls, added schemas and oversized body',async()=>{
 const a=await api(),args={request:wire(a.workspaceWireToolSchemas()),binding,approvedText:'Make report',previousMessages:null,toolRecords:[],policy};
 const request=structuredClone(args.request);request.tools[0].input_schema.additionalProperties=true;assert.throws(()=>a.validateWorkspaceRequest({...args,request}));
 assert.throws(()=>a.validateWorkspaceRequest({...args,request:{...args.request,system:'x'.repeat(49152)}}));
});

test('accepts the pinned SDK non-strict wire fixture while host tool definitions remain strict',async()=>{
 const {readFile}=await import('node:fs/promises');const fixture=JSON.parse(await readFile(new URL('./fixtures/pi-workspace/sdk-1.2.0-tools-wire.json',import.meta.url),'utf8'));
 const a=await api();assert(fixture.provenance.excerpt.includes('legacyInputSchema'));
 assert(a.workspaceToolSchemas().every(t=>t.input_schema.additionalProperties===false));
 assert(fixture.tools.every(t=>!Object.hasOwn(t.input_schema,'additionalProperties')));
 assert.deepEqual(a.workspaceWireToolSchemas(),fixture.tools);
 assert(a.validateWorkspaceRequest({request:wire(fixture.tools),binding,approvedText:'Make report',previousMessages:null,toolRecords:[],policy}));
});
