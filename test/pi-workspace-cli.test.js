import assert from 'node:assert/strict';import test from 'node:test';
import path from 'node:path';import {mkdir,writeFile,readFile,readdir} from 'node:fs/promises';
import {withPiRuntimeFixture} from './helpers/pi-runtime-fixture.js';import {piNeed} from './helpers/pi-native-fixture.js';
import {workspacePolicy,projectBriefScenario as scenario,projectBriefSteps} from './helpers/pi-workspace-fixture.js';
import {createWorkspaceCliHarness} from './helpers/pi-workspace-cli-fixture.js';
async function fixture(t,fn){const old=process.umask(0o077);t.after(()=>process.umask(old));await withPiRuntimeFixture(async f=>{
 const {activationPlan,...sourceFiles}=f.runtimeOptions.sourceFiles,installed={...f.runtimeOptions,sourceFiles},sourceRoot=path.join(f.root,'inputs'),outputRoot=path.join(f.root,'outputs');
 for(const dir of [sourceRoot,outputRoot])await mkdir(dir,{mode:0o700});for(const file of scenario.inputs)await writeFile(path.join(sourceRoot,file.name),file.text,{mode:0o600});
 await fn({...f,installed,sourceRoot,outputRoot});
},{need:{...piNeed(),pi_workspace:workspacePolicy()}});}
test('public workspace CLI confirms, revalidates and traverses owned IPC, fake SDK, five reservations and durable publication',async t=>fixture(t,async f=>{
 const h=await createWorkspaceCliHarness(t),lines=['/new','/workspace',scenario.taskText,JSON.stringify(scenario.inputs.map(f=>f.name)),f.outputRoot,'/quit'],output=[];let confirmation;
 const io={isTTY:true,write:text=>{output.push(text);if(text.startsWith('本次预览 '))confirmation=JSON.parse(text.slice(5)).confirmationCode;},readLine:async prompt=>prompt.startsWith('确认')?confirmation:lines.shift()??null};
 await h.cli.runPiChatCli({installed:f.installed,sourceRoot:f.sourceRoot,runtimeEnvFile:path.join(f.root,'never-read.env'),ports:{chat:19492,proxy:19493},io});
 assert(output.some(s=>s.startsWith('成果：')),output.join('\n'));
 assert(output.some(s=>s.startsWith('回复：')&&s.includes('合成最终回复')));
 assert(output.find(s=>s.startsWith('成果：')).includes('实际请求 5'));
 const sourceSummary=output.find(s=>s.startsWith('来源摘要：'));assert(sourceSummary&&sourceSummary.includes('source-1')&&sourceSummary.includes('source-2')&&sourceSummary.includes('sha256:'));
 assert(output.some(s=>s==='停止结果：stopped\n'));const dirs=await readdir(f.outputRoot);assert.equal(dirs.length,1);
 assert.equal(await readFile(path.join(f.outputRoot,dirs[0],'report.md'),'utf8'),scenario.report);
 const result=JSON.parse(await readFile(path.join(f.stateRoot,'attempts',`pi-workspace-${dirs[0]}`,'result.json')));assert.equal(result.status,'passed');assert.equal(result.reservations,5);
 const stats=h.stats();assert.equal(stats.starts,2);assert.equal(stats.stops,2);assert.equal(stats.requests,5);assert.equal(stats.methods.filter(m=>m==='tool').length,4);assert(stats.methods.includes('workspace'));
}));
test('changed sources after confirmation preview stop before another activation or reservation',async t=>fixture(t,async f=>{
 const h=await createWorkspaceCliHarness(t),ports={chat:19492,proxy:19493};let preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'create-session',ports});
 const room=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});assert.equal(room.status,'created');
 preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'workspace',sessionId:room.sessionId,text:scenario.taskText,ports,runtimeEnvFile:path.join(f.root,'never-read.env'),workspace:{sourceRoot:f.sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot:f.outputRoot}});
 await writeFile(path.join(f.sourceRoot,scenario.inputs[0].name),'replacement');
 const result=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});assert.equal(result.status,'failed');assert.equal(result.cleanup.status,'not-started');assert.equal(h.stats().starts,1);assert.equal(h.stats().requests,0);assert.deepEqual(await readdir(f.outputRoot),[]);
}));

test('public execution preserves a published report and reports failed-cleanup after owned child exit failure',async t=>fixture(t,async f=>{
 const h=await createWorkspaceCliHarness(t,{cleanupFailure:true}),ports={chat:19492,proxy:19493};let preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'create-session',ports});
 const room=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});assert.equal(room.status,'created');
 preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'workspace',sessionId:room.sessionId,text:scenario.taskText,ports,runtimeEnvFile:path.join(f.root,'never-read.env'),workspace:{sourceRoot:f.sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot:f.outputRoot}});
 const result=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});
 assert.equal(result.status,'failed-cleanup');assert.equal(result.cleanup.status,'failed');assert.equal(result.artifact.publication,'published');
 assert.equal(await readFile(path.join(result.outputDirectory,'report.md'),'utf8'),scenario.report);assert.equal(h.stats().requests,5);
 await assert.rejects(h.runner.preparePiCliRequest({installed:f.installed,kind:'workspace',sessionId:room.sessionId,text:scenario.taskText,ports,runtimeEnvFile:path.join(f.root,'never-read.env'),workspace:{sourceRoot:f.sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot:f.outputRoot}}));
}));

for(const invalid of ['usage','protocol'])test(`invalid intermediate ${invalid} stops before any tool or subsequent request`,async t=>fixture(t,async f=>{
 const steps=projectBriefSteps();steps[0].messagePatch=invalid==='usage'?{usage:{input:53249,output:3,cacheRead:0,cacheWrite:0,totalTokens:53252}}:{stopReason:'error'};
 const h=await createWorkspaceCliHarness(t,{steps}),ports={chat:19492,proxy:19493};let preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'create-session',ports});
 const room=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});
 preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'workspace',sessionId:room.sessionId,text:scenario.taskText,ports,runtimeEnvFile:path.join(f.root,'never-read.env'),workspace:{sourceRoot:f.sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot:f.outputRoot}});
 const result=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});assert.equal(result.status,'failed');
 assert.equal(h.stats().requests,1);assert.equal(result.newReservedFen,31);assert.equal(h.stats().methods.filter(m=>m==='tool').length,0);assert.deepEqual(await readdir(f.outputRoot),[]);
}));

test('a final text response without a report cannot become successful continuation history',async t=>fixture(t,async f=>{
 const h=await createWorkspaceCliHarness(t,{steps:[{}]}),ports={chat:19492,proxy:19493};let preview=await h.runner.preparePiCliRequest({installed:f.installed,kind:'create-session',ports});
 const room=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});
 const request={installed:f.installed,kind:'workspace',sessionId:room.sessionId,text:scenario.taskText,ports,runtimeEnvFile:path.join(f.root,'never-read.env'),workspace:{sourceRoot:f.sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot:f.outputRoot}};
 preview=await h.runner.preparePiCliRequest(request);const failed=await h.runner.runApprovedPiCliRequest({preview,confirmation:preview.confirmationCode});
 assert.equal(failed.status,'failed');assert.equal(h.stats().requests,1);assert.equal(h.stats().methods.filter(m=>m==='tool').length,0);
 await assert.rejects(h.runner.preparePiCliRequest(request));assert.equal(h.stats().starts,2);assert.deepEqual(await readdir(f.outputRoot),[]);
}));
