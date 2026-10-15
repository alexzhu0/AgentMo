import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { validateNativeChatRequest } from "../../src/native-chat-proxy.js";
import { lstat, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { it } from "node:test";
import * as native from "../../src/native-chat-runtime.js";
import { createNativeAuthorityStore } from "../../src/native-chat-authority.js";
import { buildOpenClawInstallPlan } from "../../src/openclaw-install-plan.js";
import { buildOpenClawInstallApproval, buildOpenClawSensitiveActionDecision, buildOpenClawConflictApproval } from "../../src/openclaw-install-approval.js";
import { validateOpenClawInstallReceipt } from "../../src/openclaw-install-receipt.js";
import { buildApprovedPackageFixture, packageProduceOptions } from "./package-produce-fixture.js";
import { produceAgentPackage } from "../../src/package-produce.js";
import { probeOpenClawTarget } from "../../src/openclaw-probe.js";
import { admitPackageArchiveManifest } from "../../src/package-archive.js";
import { loadAdmittedArtifact, admitCapturedArtifactBytes } from "../../src/artifact-admission.js";
import { initializeCourseBudget, initializeCourseProjectBudget, courseBudgetSummary } from "../../src/course-wiki-budget.js";

const hash = (v) => `sha256:${createHash("sha256").update(v).digest("hex")}`;
const bytes = (v) => Buffer.from(`${JSON.stringify(v, null, 2)}\n`);
export const source = `#!/usr/bin/env node
import fs from 'node:fs/promises'; import path from 'node:path'; import assert from 'node:assert/strict';
const args=process.argv.slice(2), root=process.cwd(), cfgPath=process.env.OPENCLAW_CONFIG_PATH;
if(args[0]==='--version') console.log('2026.7.1-2');
else if(args.join(' ')==='setup --help') console.log('--baseline --json');
else if(args.join(' ')==='config validate --json') console.log(JSON.stringify({valid:true}));
else {
 assert.equal(process.env.HOME,path.join(root,'home')); assert.equal(process.env.OPENCLAW_STATE_DIR,path.join(root,'state'));
 assert.equal(process.env.DEEPSEEK_API_KEY,undefined); assert.equal(process.env.AGENTMO_INSTALL_SENTINEL,undefined);
 assert.equal(process.env.MINIMAX_API_KEY,undefined);
 const cfg=JSON.parse(await fs.readFile(cfgPath,'utf8'));
 await fs.appendFile(path.join(root,'commands.jsonl'),JSON.stringify(args)+'\\n');
 if(args[0]==='setup') {
  const id=Object.keys(cfg.agents.entries)[0]; assert.deepEqual(Object.keys(cfg.agents.entries),[id]); assert.ok(id); assert.deepEqual(args,['setup','--baseline','--json']);
  assert.deepEqual(cfg.tools.deny,['*']); assert.deepEqual(cfg.agents.defaults.model.fallbacks,[]);
  const workspace=path.join(root,'workspace'),agentDir=path.join(root,'agents',id,'agent');
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(agentDir,'settings.json'),'utf8')),{retry:{provider:{maxRetries:0}}});
  assert.deepEqual(cfg.agents.entries,{[id]:{name:id,workspace,agentDir,model:'deepseek/deepseek-v4-flash'}});
  await fs.writeFile(cfgPath,JSON.stringify(cfg,null,2)+'\\n');
  console.log(JSON.stringify({ok:true,configPath:cfgPath,configStatus:'unchanged',workspaceDir:workspace,sessionsDir:path.join(root,'state','agents',id,'sessions')}));
 } else if(args.join(' ')==='agents list --json') console.log(JSON.stringify(Object.entries(cfg.agents.entries).map(([id,v])=>({id,...v}))));
 else process.exit(3);
}
`;

export function decisions(plan, suffix = "install") {
  const common={plan,decision:"approve",issuedAt:new Date(Date.now()-60_000).toISOString(),expiresAt:new Date(Date.now()+600_000).toISOString()};
  return {ordinaryApproval:buildOpenClawInstallApproval({...common,useNonce:`ordinary-${suffix}`}),
    sensitiveDecisions:plan.sensitiveActions.map((action,i)=>buildOpenClawSensitiveActionDecision({...common,action,useNonce:`sensitive-${suffix}-${i}`})),
    conflictApproval:buildOpenClawConflictApproval({...common,conflicts:[],useNonce:`conflict-${suffix}`})};
}
export async function fixture(t, executableSource=source, targetFiles, modelProfile) {
  const need=JSON.parse(await readFile(new URL('../../examples/support-triage.need.json',import.meta.url)));
  const f=await buildApprovedPackageFixture({userNeed:{...need,execution_profile:"native-chat",...modelProfile===undefined?{}:{native_model_profile:modelProfile}},targetExecutableSource:executableSource,targetFiles});
  t.after(()=>Promise.all([f.root,f.inputs.root].map(p=>rm(p,{recursive:true,force:true}))));
  const archivePath=path.join(f.root,"package.d42");
  const produced=await produceAgentPackage(packageProduceOptions(f,path.join(f.root,"package"),archivePath));
  const archive=await admitPackageArchiveManifest({archivePath,expectedArchiveDigest:produced.archiveDigest});
  const descriptorAdmission=f.inputs.targetDescriptor;
  const blueprint=await loadAdmittedArtifact({filePath:f.paths.blueprint,subject:"blueprint",expectedDigest:f.digests.blueprint});
  const contract=await loadAdmittedArtifact({filePath:f.paths['build-contract'],subject:"build-contract",expectedDigest:f.digests['build-contract']});
  const approval=await loadAdmittedArtifact({filePath:f.paths['plan-approval'],subject:"plan-approval",expectedDigest:f.digests['plan-approval']});
  const carrier=await loadAdmittedArtifact({filePath:f.paths['openclaw-target-carrier-admission'],subject:"openclaw-target-carrier-admission",expectedDigest:f.digests['openclaw-target-carrier-admission'],companions:{blueprint,'build-contract':contract,'plan-approval':approval,'openclaw-target-descriptor':descriptorAdmission}});
  const probe=await probeOpenClawTarget({archivePath,expectedArchiveDigest:produced.archiveDigest,
    blueprintPath:f.paths.blueprint,expectedBlueprintDigest:f.digests.blueprint,buildContractPath:f.paths['build-contract'],expectedBuildContractDigest:f.digests['build-contract'],
    planApprovalPath:f.paths['plan-approval'],expectedPlanApprovalDigest:f.digests['plan-approval'],targetDescriptorPath:f.paths['openclaw-target-descriptor'],expectedTargetDescriptorDigest:f.digests['openclaw-target-descriptor'],
    targetCarrierAdmissionPath:f.paths['openclaw-target-carrier-admission'],expectedTargetCarrierAdmissionDigest:f.digests['openclaw-target-carrier-admission'],targetRoot:path.dirname(f.inputs.targetFiles.packageJsonPath)});
  const probeAdmission=admitCapturedArtifactBytes({bytes:bytes(probe),subject:'openclaw-probe',expectedDigest:hash(bytes(probe)),companions:{'package-manifest':archive.manifest,'openclaw-target-carrier-admission':carrier,'openclaw-target-descriptor':descriptorAdmission}});
  const stateRoot=path.join(f.root,"agent"), authorityRoot=path.join(f.root,"authority"),budgetRoot=path.join(f.root,"budget"),legacyRoot=path.join(f.root,"legacy");
  await mkdir(budgetRoot); await mkdir(legacyRoot); await initializeCourseBudget({root:legacyRoot});
  const {budgetReference}=await initializeCourseProjectBudget({root:budgetRoot,legacyRoots:[legacyRoot]});
  const authorityRootBinding=await createNativeAuthorityStore({authorityRoot,stateRoot});
  const target=descriptorAdmission.value.target;
  const validation=probe.cli.observations.find(x=>x.id==='config-validation');
  const plan=buildOpenClawInstallPlan({execution_profile:'native-chat',lifecycle:'install',archiveBinding:{archiveSha256:produced.archiveDigest,manifestDigest:archive.manifestDigest,inventoryDigest:archive.inventoryDigest,members:archive.members},authorityRootBinding,
    target:{targetId:'openclaw',targetVersion:target.version,targetRevision:target.sourceRevision,probeFingerprintDigest:probe.fingerprintDigest,scope:'project',projectId:need.agent_id},
    nativeBinding:{agentId:need.agent_id,stateRootDigest:hash(stateRoot),workspace:'workspace',agentDir:`agents/${need.agent_id}/agent`,gatewayPort:await freePort(),proxyPort:await freePort(),budgetReference,targetDescriptorDigest:descriptorAdmission.digest,...modelProfile===undefined?{}:{modelProfile}},
    officialConfigDryRun:{commandDigest:hash(bytes(validation.argv)),resultDigest:validation.standardOutputFacts.digest,accepted:true}});
  return {root:f.root,fixture:f,probe,options:{plan,...decisions(plan),authorityRoot,archivePath,executablePath:f.inputs.targetFiles.executablePath,stateRoot,budgetRoot,descriptorAdmission,probeAdmission,blueprintAdmission:blueprint,buildContractAdmission:contract}};
}

async function freePort() {
  const server=createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  const port=server.address().port;await new Promise(resolve=>server.close(resolve));return port;
}

export const gatewaySource = source.replace('else {\n assert.equal', `else if(args[0]==='gateway') {
 const cfg=JSON.parse(await fs.readFile(cfgPath,'utf8')),id=Object.keys(cfg.agents.entries)[0];
 const port=Number(args[args.indexOf('--port')+1]);
 assert.equal(process.env.DEEPSEEK_API_KEY,undefined);
 assert.equal(process.env.NODE_DISABLE_COMPILE_CACHE,'1');assert.equal(process.env.OPENCLAW_NO_RESPAWN,'1');
 if(args[1]==='run'){
  assert.deepEqual(args,['gateway','run','--port',String(port),'--bind','loopback','--auth','token']);
  const proxy=await fetch(cfg.models.providers.deepseek.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:'Bearer '+process.env.AGENTMO_NATIVE_PROXY_TOKEN,'content-type':'application/json'},body:'{}'});
  assert.equal(proxy.status,400);
  const {createServer}=await import('node:http');
  const server=createServer((req,res)=>{
   if(req.url==='/readyz'){res.end(JSON.stringify({ready:true}));return;}
   if(req.headers.authorization!=='Bearer '+process.env.OPENCLAW_GATEWAY_TOKEN){res.writeHead(401);res.end();return;}
   res.end(JSON.stringify({ok:true,defaultAgentId:id,agents:[{agentId:id}]}));
  });
  server.listen(port,'127.0.0.1');
  process.on('SIGTERM',()=>server.close(()=>process.exit(0)));
 } else if(args[1]==='health'){
  assert.deepEqual(args,['gateway','health','--port',String(port),'--json','--timeout','10000']);
  const response=await fetch('http://127.0.0.1:'+port+'/health',{headers:{authorization:'Bearer '+process.env.OPENCLAW_GATEWAY_TOKEN}});
  assert.equal(response.status,200);console.log(await response.text());
 } else process.exit(9);
} else {\n assert.equal`);

export async function activationFixture(t, executableSource=gatewaySource, targetFiles, modelProfile) {
  const f=await fixture(t,executableSource,targetFiles,modelProfile),o=f.options;
  const installReceipt=await native.installNativeChat(o);assert.equal(installReceipt.status,'complete');
  const plan=buildOpenClawInstallPlan({execution_profile:'native-chat',lifecycle:'activate',
    ...Object.fromEntries(['archiveBinding','target','nativeBinding','authorityRootBinding','officialConfigDryRun'].map(k=>[k,o.plan[k]])),
    predecessor:{kind:'installed-native-root',installPlanDigest:o.plan.installPlanDigest,installReceiptDigest:hash(bytes(installReceipt)),rootIdentity:installReceipt.rootIdentity}});
  return { ...f, options:{...o,plan,...decisions(plan,'activate'),installReceipt,apiKey:'synthetic-provider-key'} };
}
