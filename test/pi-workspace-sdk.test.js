import assert from 'node:assert/strict';import test from 'node:test';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {fakePiSdk} from './helpers/pi-sdk-fixture.js';import {workspacePolicy} from './helpers/pi-workspace-fixture.js';import {createPiSession} from '../src/pi-sdk.js';
test('workspace session registers only trusted sequential tools and includes full skill body',async t=>{
 const mask=process.umask(0o077);t.after(()=>process.umask(mask));const root=await realpath(await mkdtemp(path.join(tmpdir(),'pi-workspace-sdk-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const sessionId=randomUUID(),sessionDir=path.join(root,'sessions',sessionId);await mkdir(sessionDir,{recursive:true,mode:0o700});
 const f=fakePiSdk(),policy=workspacePolicy(),calls=[];
 const config={stateRoot:root,sessionDir,sessionId,proxyPort:19493,systemPrompt:'Approved system',workspace:{policy,sources:[{sourceId:'source-1',logicalPath:'sources/1.md'}],taskId:randomUUID(),snapshotDigest:'sha256:'+'a'.repeat(64),records:[],execute:async x=>{calls.push(x);return {text:'approved'};}}};
 const session=await createPiSession({sdk:f.sdk,config,sessionFile:null,proxyCredential:'0'.repeat(64)});
 const actual=f.calls.create[0];assert.deepEqual(actual.tools,['read','write']);assert.equal(actual.noTools,'all');
 assert.equal(actual.resourceLoader.getSkills().skills.length,1);assert.deepEqual(actual.resourceLoader.getAgentsFiles().agentsFiles,[]);
 assert(actual.resourceLoader.getSystemPrompt().includes(policy.skill.body));
 const registered=actual.resourceLoader.getExtensions().extensions[0].tools;
 assert.deepEqual([...registered.keys()],['read','write']);assert.equal(registered.get('read').definition.executionMode,'sequential');
 const reply=await session.prompt('Make report');assert.equal(reply.text,'合成最终回复');await session.dispose();
});

test('an invalid response prevents tools and rejects another stream before delegating to the SDK',async t=>{
 const mask=process.umask(0o077);t.after(()=>process.umask(mask));const root=await realpath(await mkdtemp(path.join(tmpdir(),'pi-workspace-invalid-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const sessionId=randomUUID(),sessionDir=path.join(root,'sessions',sessionId);await mkdir(sessionDir,{recursive:true,mode:0o700});
 const f=fakePiSdk(),policy=workspacePolicy();let tools=0;
 f.workspaceSteps([{name:'read',args:{path:'sources/1.md'},messagePatch:{usage:{input:53249,output:3,cacheRead:0,cacheWrite:0,totalTokens:53252}}},{}]);
 const session=await createPiSession({sdk:f.sdk,config:{stateRoot:root,sessionDir,sessionId,proxyPort:19493,systemPrompt:'Approved',workspace:{policy,sources:[{sourceId:'source-1',logicalPath:'sources/1.md'}],taskId:randomUUID(),snapshotDigest:'sha256:'+'a'.repeat(64),records:[],execute:async()=>{tools++;return {text:'synthetic'};}}},sessionFile:null,proxyCredential:'0'.repeat(64)});
 await assert.rejects(session.prompt('Make report'));
 const actual=f.calls.create[0],before=f.calls.stream.length;
 assert.throws(()=>actual.modelRuntime.streamSimple(actual.model,{messages:[]},{}));assert.equal(f.calls.stream.length,before);
 assert.equal(before,1);assert.equal(tools,0);await session.dispose();
});
