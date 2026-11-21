import assert from 'node:assert/strict';import test from 'node:test';
import {mkdir,writeFile,readFile} from 'node:fs/promises';import path from 'node:path';import {randomUUID} from 'node:crypto';
import {withPiRuntimeFixture} from './helpers/pi-runtime-fixture.js';import {piNeed} from './helpers/pi-native-fixture.js';
import {workspacePolicy,projectBriefScenario as scenario,projectBriefSteps} from './helpers/pi-workspace-fixture.js';
import {fakePiSdk} from './helpers/pi-sdk-fixture.js';import {stubPiUpstream} from './helpers/pi-https-fixture.js';import {piHttpRequest,piNativeResponse} from './helpers/pi-http-fixture.js';
import {createPiSessionHost} from '../src/pi-session-host.js';import {createPiWorkspaceBridge} from '../src/pi-native-runtime.js';
import {createPiTurnController,createPiBudgetHandler} from '../src/pi-budget-proxy.js';
import {captureWorkspace,captureWorkspaceOutput,publishWorkspaceArtifact,finishWorkspaceArtifact} from '../src/pi-workspace-files.js';
import {workspaceWireToolSchemas} from '../src/pi-workspace-protocol.js';import {piHash} from '../src/pi-install-plan.js';
import {preparePiCliRequest,runApprovedPiCliRequest} from '../src/pi-cli-run.js';
function wire({context}){
 const messages=[];
 for(const m of context.messages){
  if(m.role==='system')continue;
  if(m.role==='toolResult')messages.push({role:'user',content:[{type:'tool_result',tool_use_id:m.toolCallId,content:m.content,is_error:false}]});
  else messages.push({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(p=>p.type==='text'?{type:'text',text:p.text}:{type:'tool_use',id:p.id,name:p.name,input:p.arguments})});
 }
 return {model:'MiniMax-M3',stream:true,max_tokens:2048,thinking:{type:'disabled'},system:context.messages[0].content,tools:workspaceWireToolSchemas(),messages};
}
test('approved planning through synthetic installation, parent tools, native loop, budget and artifact',async t=>{
 const old=process.umask(0o077);t.after(()=>process.umask(old));stubPiUpstream(t,async()=>piNativeResponse());
 await withPiRuntimeFixture(async f=>{
  const binding=f.activationPlan.nativeBinding, fake=fakePiSdk();
  let controller=await createPiTurnController({binding,stateRoot:f.stateRoot,approvedCases:[]}),bridge,token;
  const turnClient={admit:async input=>{const admitted=await controller.admit(input);token=admitted.turnToken;return admitted;},finish:async input=>{if(input.status==='completed')await bridge.complete(input);return controller.finish(input);},state:id=>controller.state(id),status:()=>controller.status(),workspace:id=>bridge.context({sessionId:id}),tool:input=>bridge.execute(input)};
  const host=await createPiSessionHost({stateRoot:f.stateRoot,binding,sdk:fake.sdk,turnClient});t.after(()=>host.close());
  const {id:sessionId}=await host.createSession(),taskId=randomUUID(),sourceRoot=path.join(f.root,'input'),outputRoot=path.join(f.root,'output'),attemptRoot=path.join(f.stateRoot,'attempts',`pi-workspace-${taskId}`);
  for(const dir of [sourceRoot,outputRoot,attemptRoot])await mkdir(dir,{mode:0o700});
  for(const file of scenario.inputs)await writeFile(path.join(sourceRoot,file.name),file.text,{mode:0o600});
  const snapshot=await captureWorkspace({sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),skill:binding.pi_workspace.skill});
  const workspace={taskId,sessionId,snapshot,attemptRoot,approvedText:scenario.taskText,deadline:Date.now()+600000};
  bridge=await createPiWorkspaceBridge({binding,workspace,stateRoot:f.stateRoot});
  const approvedCases=[{caseId:'workspace',sessionId,inputDigest:piHash(scenario.taskText)}];
  controller=await createPiTurnController({binding,stateRoot:f.stateRoot,approvedCases,workspace:bridge.controller});
  const handler=createPiBudgetHandler({binding,stateRoot:f.stateRoot,budgetRoot:f.budgetRoot,apiKey:'synthetic',controller});
  fake.workspaceSteps(projectBriefSteps());fake.workspaceRequest(async call=>{assert.equal((await piHttpRequest(handler,wire(call),{'x-api-key':token})).statusCode,200);});
  const turnId=randomUUID();await host.submit({caseId:'workspace',sessionId,turnId,text:scenario.taskText});
  let final;for await(const event of host.events(turnId))final=event;
  assert.equal(final.status,'completed');assert.equal(handler.summary().newReservations,5);assert.equal(bridge.count,4);
  const output=await captureWorkspaceOutput({outputRoot,taskId,excludedRoots:[sourceRoot,f.stateRoot,f.authorityRoot,f.budgetRoot]});
  const taskBinding={...workspace,policy:binding.pi_workspace,snapshotDigest:snapshot.snapshotDigest,agentDigest:binding.packageArchiveDigest,output};
  const manifest=await publishWorkspaceArtifact({binding:taskBinding,staged:bridge.staged,finalReply:final.text,sessionDurable:true,taskState:{status:'completed',activeRequests:0,toolsBusy:false,skillInContext:true,requests:5,tools:4,reservations:5}});
  await host.close();await finishWorkspaceArtifact({binding:taskBinding,manifest,cleanup:'stopped'});
  assert.equal(await readFile(path.join(output.directory,'report.md'),'utf8'),scenario.report);
  const {activationPlan,...sourceFiles}=f.runtimeOptions.sourceFiles;
  const installed={...f.runtimeOptions,sourceFiles};
  const before=await readFile(path.join(f.authorityRoot,'consumption.jsonl'));
  const runtimeEnvFile=path.join(f.root,'never-read.env');
  const preview=await preparePiCliRequest({installed,kind:'workspace',sessionId,text:scenario.taskText,ports:{chat:19492,proxy:19493},runtimeEnvFile,workspace:{sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot}});
  assert.equal(preview.executionReady,true);assert.equal(typeof preview.confirmationCode,'string');assert.equal(preview.maximumNewReservedFen,186);
  assert.equal((await runApprovedPiCliRequest({preview,confirmation:null})).status,'declined');
  assert.deepEqual(await readFile(path.join(f.authorityRoot,'consumption.jsonl')),before);
  const nextTask=randomUUID(),nextAttempt=path.join(f.stateRoot,'attempts',`pi-workspace-${nextTask}`);await mkdir(nextAttempt,{mode:0o700});
  const recovered=await createPiWorkspaceBridge({binding,workspace:{...workspace,taskId:nextTask,attemptRoot:nextAttempt},stateRoot:f.stateRoot});
  assert.equal(recovered.context({sessionId}).records.length,4);assert(recovered.controller.binding.historyMessages.some(m=>Array.isArray(m.content)&&m.content.some(p=>p.type==='tool_result')));
  await assert.rejects(preparePiCliRequest({installed,kind:'workspace',sessionId,text:scenario.taskText,ports:{chat:19492,proxy:19493},runtimeEnvFile,workspace:{sourceRoot,relativePaths:scenario.inputs.map(f=>f.name),outputRoot}}));
 },{need:{...piNeed(),pi_workspace:workspacePolicy()}});
});
