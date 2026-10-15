import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { validateNativeChatRequest } from "../src/native-chat-proxy.js";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import * as native from "../src/native-chat-runtime.js";
import { createNativeAuthorityStore } from "../src/native-chat-authority.js";
import { buildOpenClawInstallPlan } from "../src/openclaw-install-plan.js";
import { buildOpenClawInstallApproval, buildOpenClawSensitiveActionDecision, buildOpenClawConflictApproval } from "../src/openclaw-install-approval.js";
import { validateOpenClawInstallReceipt } from "../src/openclaw-install-receipt.js";
import { buildApprovedPackageFixture, packageProduceOptions } from "./helpers/package-produce-fixture.js";
import { produceAgentPackage } from "../src/package-produce.js";
import { probeOpenClawTarget } from "../src/openclaw-probe.js";
import { admitPackageArchiveManifest } from "../src/package-archive.js";
import { loadAdmittedArtifact, admitCapturedArtifactBytes } from "../src/artifact-admission.js";
import { initializeCourseBudget, initializeCourseProjectBudget, courseBudgetSummary } from "../src/course-wiki-budget.js";

const hash = (v) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
import { source, decisions, fixture } from "./helpers/native-chat-fixture.js";

it('native installation rejects stale authority before mutation',async(t)=>{
  const {options:o}=await fixture(t),journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
  assert.equal(typeof native.installNativeChat,'function','native installation entry must exist');
  for(const [i,change] of [x=>{x.plan.nativeBinding.gatewayPort++;},x=>{x.stateRoot+='-other';},x=>{x.budgetRoot=o.stateRoot;},x=>{x.descriptorAdmission={...x.descriptorAdmission};},x=>{x.probeAdmission={...x.probeAdmission};},x=>{x.ordinaryApproval.decision='reject';},x=>{x.alreadyConsumed=true;}].entries()) {
    const request={...o,plan:structuredClone(o.plan),ordinaryApproval:structuredClone(o.ordinaryApproval)}; change(request);
    await assert.rejects(native.installNativeChat(request),{code:'AGENTMO_NATIVE_INSTALL_REJECTED'},`mutation ${i}`);
    await assert.rejects(lstat(o.stateRoot),{code:'ENOENT'}); assert.deepEqual(await readFile(journal),before);
  }
  await writeFile(o.archivePath,'changed');
  await assert.rejects(native.installNativeChat(o),{code:'AGENTMO_NATIVE_INSTALL_REJECTED'});
  assert.deepEqual(await readFile(journal),before);
});

it('native installation rejects changed runtime bytes before consuming any approval',async(t)=>{
  const {options:o}=await fixture(t),journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
  await writeFile(o.executablePath,'#!/usr/bin/env node\nprocess.exit(0);\n');
  await assert.rejects(native.installNativeChat(o),{code:'AGENTMO_NATIVE_INSTALL_REJECTED'});
  await assert.rejects(lstat(o.stateRoot),{code:'ENOENT'}); assert.deepEqual(await readFile(journal),before);
});

it('does not certify registration when the runtime changes workspace or permissions',async(t)=>{
  for(const variant of [
    source.replace("await fs.writeFile(cfgPath,JSON.stringify(cfg,null,2)", "cfg.plugins.enabled=true; await fs.writeFile(cfgPath,JSON.stringify(cfg,null,2)"),
    source.replace("console.log(JSON.stringify({ok:true", "await fs.writeFile(path.join(workspace,'AGENTS.md'),'tampered'); console.log(JSON.stringify({ok:true"),
    source.replace("({id,...v})", "({id:'wrong-agent',...v})"),
  ]) {
    const {options:o}=await fixture(t,variant),receipt=await native.installNativeChat(o);
    assert.equal(receipt.status,'incomplete'); assert.equal(receipt.certificationBoundary.installed,false);
    assert.equal(validateOpenClawInstallReceipt({...receipt,status:'complete',failureCode:null}).ok,false);
  }
});

it('registers the installed OpenClaw in disposable state without invoking a model',{
  skip:process.env.AGENTMO_TEST_NATIVE_OPENCLAW!=='1',
},async(t)=>{
  const base='/Users/alexzhu/.local/lib/node_modules/openclaw';
  const {options:o}=await fixture(t,undefined,{executablePath:path.join(base,'openclaw.mjs'),packageJsonPath:path.join(base,'package.json'),buildInfoPath:path.join(base,'dist/build-info.json')});
  const before=await courseBudgetSummary({root:o.budgetRoot,budgetReference:o.plan.nativeBinding.budgetReference});
  const receipt=await native.installNativeChat(o);
  assert.equal(receipt.status,'complete',JSON.stringify(receipt));
  assert.equal(receipt.commandResults.length,3); assert.equal(receipt.certificationBoundary.active,false);
  assert.deepEqual(await courseBudgetSummary({root:o.budgetRoot,budgetReference:o.plan.nativeBinding.budgetReference}),before);
});

it('rejects the extra default agent produced by a native roster migration',async(t)=>{
  const migrated=source.replace("Object.entries(cfg.agents.entries).map(([id,v])=>({id,...v}))", "[{id:'main',workspace:cfg.agents.defaults.workspace,agentDir:path.join(root,'state/agents/main/agent'),model:'deepseek/deepseek-v4-flash'},...Object.entries(cfg.agents.entries).map(([id,v])=>({id,...v}))]");
  const {options:o}=await fixture(t,migrated),receipt=await native.installNativeChat(o);
  assert.equal(receipt.status,'incomplete'); assert.equal(receipt.commandResults.length,1);
  assert.equal(receipt.certificationBoundary.installed,false); assert.equal(receipt.certificationBoundary.active,false);
  assert.deepEqual(receipt.managedFiles,[]);
});

it('creates one isolated native agent from the exact package without spending or activation',async(t)=>{
  const {root,options:o}=await fixture(t),sentinel=path.join(root,'host-config.json'); await writeFile(sentinel,'unchanged');
  assert.equal(typeof native.installNativeChat,'function','native installation entry must exist');
  const budget=await courseBudgetSummary({root:o.budgetRoot,budgetReference:o.plan.nativeBinding.budgetReference});
  const receipt=await native.installNativeChat(o);
  assert.equal(receipt.status,'complete'); assert.equal(receipt.execution_profile,'native-chat');
  assert.equal(receipt.certificationBoundary.runtime,false); assert.equal(receipt.certificationBoundary.active,false);
  assert.equal(validateOpenClawInstallReceipt(receipt).ok,true);
  assert.equal(validateOpenClawInstallReceipt({...receipt,certificationBoundary:{...receipt.certificationBoundary,active:true}}).ok,false);
  assert.equal(JSON.stringify(receipt).includes(root),false);
  assert.deepEqual(JSON.parse(await readFile(path.join(o.stateRoot,'install-receipt.json'),'utf8')),receipt);
  const config=JSON.parse(await readFile(path.join(o.stateRoot,'config.json'),'utf8'));
  assert.deepEqual(Object.keys(config.agents.entries),[o.plan.nativeBinding.agentId]);
  assert.deepEqual(config.tools.deny,['*']); assert.deepEqual(config.agents.defaults.model.fallbacks,[]);
  assert.equal(config.models.providers.deepseek.baseUrl,`http://127.0.0.1:${o.plan.nativeBinding.proxyPort}/v1`);
  assert.deepEqual(config.browser,{enabled:false});
  assert.deepEqual(config.discovery,{mdns:{mode:'off'}});
  assert.deepEqual(config.update,{checkOnStart:false,auto:{enabled:false}});
  assert.deepEqual(config.agents.defaults.compaction,{enabled:false,memoryFlush:{enabled:false}});
  assert.equal((await lstat(path.join(o.stateRoot,'native-chat-attempts'))).mode&0o777,0o700);
  assert.deepEqual(config.models.providers.deepseek.apiKey,{source:'env',provider:'default',id:'AGENTMO_NATIVE_PROXY_TOKEN'});
  for(const op of o.plan.operations.filter(x=>x.operation==='copy-workspace')) assert.equal(hash(await readFile(path.join(o.stateRoot,op.path))),op.desiredDigest);
  assert.equal(await readFile(sentinel,'utf8'),'unchanged');
  assert.deepEqual(await courseBudgetSummary({root:o.budgetRoot,budgetReference:o.plan.nativeBinding.budgetReference}),budget);
  await rm(o.stateRoot,{recursive:true}); await assert.rejects(native.installNativeChat(o),{code:'AGENTMO_NATIVE_INSTALL_REJECTED'});
  await assert.rejects(lstat(o.stateRoot),{code:'ENOENT'});
});

it('installed OpenClaw emits the admitted text-only envelope with prior assistant history',{
  skip:process.env.AGENTMO_TEST_NATIVE_OPENCLAW!=='1',timeout:120_000,
},async(t)=>{
  const base='/Users/alexzhu/.local/lib/node_modules/openclaw';
  const {options:o}=await fixture(t,undefined,{executablePath:path.join(base,'openclaw.mjs'),packageJsonPath:path.join(base,'package.json'),buildInfoPath:path.join(base,'dist/build-info.json')});
  assert.equal((await native.installNativeChat(o)).status,'complete');
  const captured=[];
  const server=createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);captured.push(JSON.parse(Buffer.concat(chunks)));
    res.writeHead(200,{'content-type':'text/event-stream'});
    res.end(`data: ${JSON.stringify({id:'synthetic',object:'chat.completion.chunk',created:1,model:'deepseek-v4-flash',choices:[{index:0,delta:{role:'assistant',content:'Owner: Amy.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3,total_tokens:23}})}\n\ndata: [DONE]\n\n`);
  });
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(o.plan.nativeBinding.proxyPort,'127.0.0.1',resolve);});
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));});
  for(const message of ['Owner is Amy.','Correction: owner is Ben.']){
    const child=spawn(o.executablePath,['agent','--local','--agent',o.plan.nativeBinding.agentId,'--session-id','synthetic-native-envelope','--thinking','off','--verbose','off','--timeout','30','--message',message,'--json'],
      {cwd:o.stateRoot,env:{...native.nativeChildEnvironment(o.stateRoot),AGENTMO_NATIVE_PROXY_TOKEN:'a'.repeat(64)},stdio:['ignore','pipe','pipe'],detached:true});
    await native.settleNativeChild(child,{timeout:45_000,stop:()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}}});
  }
  assert.equal(captured.length,2,'one request per native turn');
  for(const wire of captured)assert.doesNotThrow(()=>validateNativeChatRequest(wire),`native field names: ${Object.keys(wire).sort().join(',')}`);
  assert.ok(captured[1].messages.some(m=>m.role==='assistant'),'prior assistant history retained');
  assert.equal((await courseBudgetSummary({root:o.budgetRoot,budgetReference:o.plan.nativeBinding.budgetReference})).projectReservations,0);
});

it('retains an incomplete native result on registration failure and never retries',async(t)=>{
  const failing=source.replace("const id=Object.keys(cfg.agents.entries)[0];", "process.exit(7); const id=Object.keys(cfg.agents.entries)[0];");
  const {options:o}=await fixture(t,failing);
  assert.equal(typeof native.installNativeChat,'function','native installation entry must exist');
  const receipt=await native.installNativeChat(o);
  assert.equal(receipt.status,'incomplete'); assert.equal(receipt.certificationBoundary.active,false);
  assert.equal(validateOpenClawInstallReceipt(receipt).ok,true);
  assert.equal((await readFile(path.join(o.stateRoot,'commands.jsonl'),'utf8')).trim().split('\n').length,1);
  await assert.rejects(native.installNativeChat(o),{code:'AGENTMO_NATIVE_INSTALL_REJECTED'});
  assert.equal((await readdir(o.authorityRoot)).includes('consumption.jsonl'),true);
});

it('public install preview and apply use the native package branch and retain exact approval gates',async(t)=>{
  const {root,fixture:f,probe,options:o}=await fixture(t);
  const files={};
  async function artifact(name,value){const file=path.join(root,`${name}.json`),data=bytes(value);await writeFile(file,data);files[name]=[file,hash(data)];}
  await artifact('probe',probe);
  await artifact('request',{target:o.plan.target,nativeBinding:o.plan.nativeBinding,authorityRootBinding:o.plan.authorityRootBinding});
  for(const [name,value]of Object.entries({ordinary:o.ordinaryApproval,conflict:o.conflictApproval,...Object.fromEntries(o.sensitiveDecisions.map((d,i)=>[`sensitive-${i}`,d]))}))await artifact(name,value);
  const sources=[['blueprint','blueprint'],['build-contract','build-contract'],['plan-approval','plan-approval'],['target-descriptor','openclaw-target-descriptor'],['target-carrier-admission','openclaw-target-carrier-admission']].flatMap(([flag,key])=>[`--${flag}`,f.paths[key],`--${flag}-sha256`,f.digests[key]]);
  const common=['--execution-profile','native-chat','--lifecycle','install','--archive',o.archivePath,'--archive-sha256',o.plan.archiveBinding.archiveSha256,...sources,
    '--probe',...files.probe.slice(0,1),'--probe-sha256',files.probe[1],'--target-root',o.stateRoot,'--openclaw-target-root',path.dirname(o.executablePath),'--budget-root',o.budgetRoot];
  const out=path.join(root,'preview.json');
  const run=(command,args)=>spawnSync(process.execPath,['bin/agentmo.js',command,...args],{cwd:new URL('..',import.meta.url),encoding:'utf8',timeout:45_000});
  const preview=run('openclaw-install-preview',[...common,'--request',files.request[0],'--request-sha256',files.request[1],'--out',out,'--json']);
  assert.equal(preview.status,0,preview.stderr); assert.deepEqual(JSON.parse(await readFile(out,'utf8')),o.plan);
  const apply=[...common,'--install-plan',out,'--install-plan-sha256',hash(await readFile(out)),
    '--ordinary-approval',files.ordinary[0],'--ordinary-approval-sha256',files.ordinary[1],
    '--conflict-approval',files.conflict[0],'--conflict-approval-sha256',files.conflict[1],
    ...o.sensitiveDecisions.flatMap((_,i)=>['--sensitive-decision',files[`sensitive-${i}`][0],'--sensitive-decision-sha256',files[`sensitive-${i}`][1]]),
    '--native-authority-root',o.authorityRoot,'--out',path.join(root,'receipt.json'),'--json'];
  const journal=await readFile(path.join(o.authorityRoot,'consumption.jsonl'));
  const wrong=apply.map(v=>v===files.ordinary[1]?hash('wrong'):v),rejected=run('openclaw-install-apply',wrong);
  assert.notEqual(rejected.status,0); assert.deepEqual(await readFile(path.join(o.authorityRoot,'consumption.jsonl')),journal);
  await assert.rejects(lstat(o.stateRoot),{code:'ENOENT'});
  const applied=run('openclaw-install-apply',apply); assert.equal(applied.status,0,applied.stderr);
  assert.equal(JSON.parse(applied.stdout).receipt.status,'complete');
  assert.equal(JSON.parse(await readFile(path.join(root,'receipt.json'),'utf8')).execution_profile,'native-chat');
});
