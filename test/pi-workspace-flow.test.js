import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,realpath,writeFile,readFile,readdir,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';import {randomUUID} from 'node:crypto';
import {fakePiSdk} from './helpers/pi-sdk-fixture.js';
import {workspacePolicy,projectBriefScenario,projectBriefSteps} from './helpers/pi-workspace-fixture.js';
import {createPiSession} from '../src/pi-sdk.js';
import {captureWorkspace,createWorkspaceTools,captureWorkspaceOutput,publishWorkspaceArtifact,finishWorkspaceArtifact,recoverWorkspaceArtifact} from '../src/pi-workspace-files.js';
import {validateWorkspaceHistory} from '../src/pi-workspace-protocol.js';
async function fixture(t){
 const old=process.umask(0o077);t.after(()=>process.umask(old));
 const root=await realpath(await mkdtemp(path.join(tmpdir(),'workspace-flow-')));t.after(()=>rm(root,{recursive:true,force:true}));
 const policy=workspacePolicy(),sessionId=randomUUID(),taskId=randomUUID(),sourceRoot=path.join(root,'input'),attemptRoot=path.join(root,'state','attempts',`pi-workspace-${taskId}`),outputRoot=path.join(root,'output'),stateRoot=path.join(root,'state'),sessionDir=path.join(stateRoot,'sessions',sessionId);
 for(const dir of [sourceRoot,attemptRoot,outputRoot,sessionDir])await mkdir(dir,{recursive:true,mode:0o700});
 await writeFile(path.join(sourceRoot,'facts.md'),'Project Atlas\nOwner: Ada\n');await writeFile(path.join(sourceRoot,'risks.txt'),'Launch date remains unconfirmed.\n');
 const snapshot=await captureWorkspace({sourceRoot,relativePaths:['facts.md','risks.txt'],skill:policy.skill});
 const output=await captureWorkspaceOutput({outputRoot,taskId,excludedRoots:[sourceRoot,stateRoot,attemptRoot]});
 const binding={taskId,sessionId,policy,snapshotDigest:snapshot.snapshotDigest,agentDigest:'sha256:'+'a'.repeat(64),output,attemptRoot,deadline:Date.now()+600000};
 const tools=createWorkspaceTools({binding,snapshot,attemptRoot}),fake=fakePiSdk(),records=[];
 const content=projectBriefScenario.report;
 fake.workspaceSteps(projectBriefSteps());
 const config={stateRoot,sessionDir,sessionId,proxyPort:19493,systemPrompt:'Approved system',workspace:{policy,sources:snapshot.sources.map(({sourceId,logicalPath})=>({sourceId,logicalPath})),taskId,snapshotDigest:snapshot.snapshotDigest,records,execute:input=>tools.execute(input)}};
 return {root,binding,tools,fake,config,content,records,snapshot};
}
test('native five-request fixture stages cited bytes, persists tool history, recovers and publishes without overwrite',async t=>{
 const f=await fixture(t);const session=await createPiSession({sdk:f.fake.sdk,config:f.config,sessionFile:null,proxyCredential:'0'.repeat(64)});
 const reply=await session.prompt('Prepare the project brief');assert.equal(f.fake.calls.stream.length,5);assert.equal(f.tools.count,4);
 for(const call of f.fake.calls.stream)assert(call.context.messages[0].content.includes(f.binding.policy.skill.body));
 validateWorkspaceHistory({entries:session.readEntries(),binding:f.binding,toolRecords:f.records});
 const sessionFile=session.getSessionFile();await session.dispose();
 const recoveryInput=path.join(f.root,'recovery.json'),{execute,...workspace}=f.config.workspace;
 await writeFile(recoveryInput,JSON.stringify({config:{...f.config,workspace},sessionFile}),{mode:0o600});
 const before=await readFile(sessionFile);
 const child=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./helpers/pi-workspace-recovery-child.js',import.meta.url)),recoveryInput],{env:{PATH:'/usr/local/bin:/usr/bin:/bin',TMPDIR:'/private/tmp'}});
 assert.deepEqual(JSON.parse(child.stdout),{toolResults:4,prompts:0,opens:1});assert.deepEqual(await readFile(sessionFile),before);
 const recovered=await createPiSession({sdk:f.fake.sdk,config:f.config,sessionFile,proxyCredential:'0'.repeat(64)});assert.equal(recovered.readEntries().filter(e=>e.message?.role==='toolResult').length,4);await recovered.dispose();
 const taskState={status:'completed',activeRequests:0,toolsBusy:false,skillInContext:true,requests:5,tools:4,reservations:5};
 const manifest=await publishWorkspaceArtifact({binding:f.binding,staged:f.tools.staged,finalReply:reply.text,sessionDurable:true,taskState});
 assert.equal(await readFile(path.join(f.binding.output.directory,'report.md'),'utf8'),f.content);
 assert.deepEqual(manifest.citations,projectBriefScenario.citations);
 assert(!JSON.stringify(manifest).includes('Atlas'));assert(!JSON.stringify(manifest).includes(f.root));
 const result=await finishWorkspaceArtifact({binding:f.binding,manifest,cleanup:'stopped'});assert.equal(result.status,'passed');assert.equal((await recoverWorkspaceArtifact({attemptRoot:f.binding.attemptRoot})).status,'passed');
 await assert.rejects(publishWorkspaceArtifact({binding:f.binding,staged:f.tools.staged,finalReply:reply.text,sessionDurable:true,taskState}));
});
test('history cannot reuse other sessions, snapshots, replayed IDs or incomplete tool chains',async t=>{
 const f=await fixture(t),session=await createPiSession({sdk:f.fake.sdk,config:f.config,sessionFile:null,proxyCredential:'0'.repeat(64)});
 await session.prompt('Prepare brief');const entries=session.readEntries();await session.dispose();
 for(const binding of [{...f.binding,sessionId:randomUUID()},{...f.binding,snapshotDigest:'sha256:'+'b'.repeat(64)}])assert.throws(()=>validateWorkspaceHistory({entries,binding,toolRecords:f.records}));
 assert.throws(()=>validateWorkspaceHistory({entries:entries.slice(0,-1),binding:f.binding,toolRecords:f.records}));
 assert.throws(()=>validateWorkspaceHistory({entries:[...entries,...entries],binding:f.binding,toolRecords:f.records}));
 const nextAttempt=path.join(f.root,'followup');await mkdir(nextAttempt,{mode:0o700});
 const prior=f.tools.records.filter(r=>r.name==='read').map(r=>({...r,taskStatus:'passed'}));
 const tools=createWorkspaceTools({binding:{...f.binding,taskId:randomUUID()},snapshot:f.snapshot,admittedHistoryRecords:prior,attemptRoot:nextAttempt});
 await tools.execute({taskId:prior[0].taskId,sessionId:f.binding.sessionId,toolCallId:'bad-task',name:'read',args:{path:'sources/1.md'}}).then(()=>assert.fail(),()=>{});
 const nextBinding={...f.binding,taskId:randomUUID()},followup=createWorkspaceTools({binding:nextBinding,snapshot:f.snapshot,admittedHistoryRecords:prior,attemptRoot:nextAttempt});
 await followup.execute({taskId:nextBinding.taskId,sessionId:f.binding.sessionId,toolCallId:'followup',name:'write',args:{path:'output/report.md',content:'Atlas [source-1:L1]'}});
 assert.equal(followup.count,1);
 assert.throws(()=>createWorkspaceTools({binding:nextBinding,snapshot:f.snapshot,admittedHistoryRecords:prior.map(r=>({...r,taskStatus:'failed'})),attemptRoot:nextAttempt}));
});
test('publication gates and interrupted metadata preserve artifacts and report uncertainty',async t=>{
 const f=await fixture(t),session=await createPiSession({sdk:f.fake.sdk,config:f.config,sessionFile:null,proxyCredential:'0'.repeat(64)});const reply=await session.prompt('Prepare brief');await session.dispose();
 const args={binding:f.binding,staged:f.tools.staged,finalReply:reply.text,sessionDurable:true,taskState:{status:'completed',activeRequests:0,toolsBusy:false,skillInContext:true,requests:5,tools:4,reservations:5}};
 for(const patch of [{sessionDurable:false},{finalReply:''},{staged:null},{signal:AbortSignal.abort()},{taskState:{...args.taskState,activeRequests:1}},{taskState:{...args.taskState,skillInContext:false}}])await assert.rejects(publishWorkspaceArtifact({...args,...patch}));
 // Create-only result collision models failure after the report has been durably written.
 await writeFile(path.join(f.binding.attemptRoot,'artifact.json'),'existing',{mode:0o600});
 await assert.rejects(publishWorkspaceArtifact(args),e=>e.code==='publication-uncertain');
 assert.equal((await recoverWorkspaceArtifact({attemptRoot:f.binding.attemptRoot})).status,'publication-uncertain');
 const files=(await readdir(f.binding.attemptRoot)).sort(),before=await Promise.all(files.map(name=>readFile(path.join(f.binding.attemptRoot,name))));
 const child=await promisify(execFile)(process.execPath,[fileURLToPath(new URL('./helpers/pi-workspace-artifact-recovery-child.js',import.meta.url)),f.binding.attemptRoot],{env:{PATH:'/usr/local/bin:/usr/bin:/bin',TMPDIR:'/private/tmp'}});
 assert.equal(JSON.parse(child.stdout).status,'publication-uncertain');
 assert.deepEqual((await readdir(f.binding.attemptRoot)).sort(),files);
 assert.deepEqual(await Promise.all(files.map(name=>readFile(path.join(f.binding.attemptRoot,name)))),before);
 assert.equal(await readFile(path.join(f.binding.output.directory,'report.md'),'utf8'),f.content);
 await assert.rejects(publishWorkspaceArtifact(args));
});

test('published output remains available when owned cleanup fails',async t=>{
 const f=await fixture(t),session=await createPiSession({sdk:f.fake.sdk,config:f.config,sessionFile:null,proxyCredential:'0'.repeat(64)});
 const reply=await session.prompt('Prepare brief');await session.dispose();
 const manifest=await publishWorkspaceArtifact({binding:f.binding,staged:f.tools.staged,finalReply:reply.text,sessionDurable:true,taskState:{status:'completed',activeRequests:0,toolsBusy:false,skillInContext:true,requests:5,tools:4,reservations:5}});
 assert.equal((await finishWorkspaceArtifact({binding:f.binding,manifest,cleanup:'failed'})).status,'failed-cleanup');
 assert.equal((await recoverWorkspaceArtifact({attemptRoot:f.binding.attemptRoot})).status,'failed-cleanup');
 assert.equal(await readFile(path.join(f.binding.output.directory,'report.md'),'utf8'),f.content);
});
