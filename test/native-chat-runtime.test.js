import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it } from "node:test";
import { buildOpenClawTargetDescriptor } from "../src/openclaw-target-descriptor.js";
import { probeNativeChatTarget } from "../src/native-chat-runtime.js";
import { nativeChatModelProfile } from "../src/native-chat-model-profile.js";

const digest = (bytes) => `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
async function describeTarget(root) {
  const executablePath = path.join(root, "openclaw.mjs");
  const packageJsonPath = path.join(root, "package.json");
  const buildInfoPath = path.join(root, "dist/build-info.json");
  const descriptor = await buildOpenClawTargetDescriptor({ executablePath, packageJsonPath, buildInfoPath,
    digests: { "target-executable": digest(await readFile(executablePath)), "target-package-json": digest(await readFile(packageJsonPath)), "target-build-info": digest(await readFile(buildInfoPath)) } });
  return { descriptor, executablePath };
}
async function fixture(output) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-native-probe-test-")));
  const root = path.join(parent, "target");
  await mkdir(path.join(root, "dist"), { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({ name: "openclaw", version: "2026.9.4", engines: { node: ">=20" } }));
  await writeFile(path.join(root, "dist/build-info.json"), JSON.stringify({ version: "2026.9.4", commit: "a".repeat(40) }));
  await writeFile(path.join(root, "openclaw.mjs"), `#!/usr/bin/env node\nprocess.stderr.write('synthetic diagnostic');console.log(${JSON.stringify(output)});\n`, { mode: 0o755 });
  return { ...await describeTarget(root), probeRoot: path.join(parent, "probe"), parent };
}

it("rejects target drift and occupied or linked probe roots before creating isolated files", async () => {
  const { parent, ...options } = await fixture("2026.9.4");
  await assert.rejects(probeNativeChatTarget({ ...options, extra: true }), { code: "AGENTMO_NATIVE_OPTIONS_REJECTED" });
  await assert.rejects(lstat(options.probeRoot), { code: "ENOENT" });
  await symlink(parent, options.probeRoot);
  await assert.rejects(probeNativeChatTarget(options), { code: "AGENTMO_NATIVE_PROBE_REJECTED" });
  await assert.rejects(lstat(path.join(parent, "config.json")), { code: "ENOENT" });
  await writeFile(options.executablePath, "throw new Error('drift');\n");
  await assert.rejects(probeNativeChatTarget({ ...options, probeRoot: path.join(parent, "absent") }), { code: "AGENTMO_NATIVE_PROBE_REJECTED" });
  await assert.rejects(lstat(path.join(parent, "absent")), { code: "ENOENT" });
});

it("rejects successful exit codes that do not establish the exact native version and command contract", async () => {
  for (const [output, code] of [["9999.1", "AGENTMO_NATIVE_VERSION_REJECTED"], ["2026.9.4", "AGENTMO_NATIVE_COMMAND_REJECTED"]]) {
    const { parent, ...options } = await fixture(output);
    await assert.rejects(probeNativeChatTarget(options), { code });
    assert.equal((await lstat(options.probeRoot)).mode & 0o777, 0o700);
    assert.equal((await lstat(path.join(options.probeRoot, "config.json"))).mode & 0o777, 0o600);
  }
});

it("validates the installed OpenClaw against a synthetic native configuration without invoking a model", {
  skip: process.env.AGENTMO_TEST_NATIVE_OPENCLAW !== "1",
}, async () => {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), "agentmo-native-installed-probe-")));
  const target = await describeTarget("/Users/alexzhu/.local/lib/node_modules/openclaw");
  const observations = await probeNativeChatTarget({ ...target, probeRoot: path.join(parent, "probe") });
  assert.deepEqual(observations.map(({ id, exitCode }) => [id, exitCode]), [["version", 0], ["agent-registration-command", 0], ["config-validation", 0]]);
  assert.equal(JSON.stringify(observations).includes(parent), false);
});

it("re-admits exact installed bytes before activation and rejects changed receipt, root or workspace", async t => {
  const { fixture, decisions } = await import('./helpers/native-chat-fixture.js');
  const native = await import('../src/native-chat-runtime.js');
  const { buildOpenClawInstallPlan } = await import('../src/openclaw-install-plan.js');
  const { consumeNativeAuthoritySet } = await import('../src/native-chat-authority.js');
  const { options:o } = await fixture(t);
  const receipt = await native.installNativeChat(o);
  assert.equal(receipt.status, 'complete');
  assert.equal(typeof native.preflightNativeChatActivation, 'function');
  const plan = buildOpenClawInstallPlan({ execution_profile:'native-chat', lifecycle:'activate',
    ...Object.fromEntries(['archiveBinding','target','nativeBinding','authorityRootBinding','officialConfigDryRun'].map(k=>[k,o.plan[k]])),
    predecessor:{kind:'installed-native-root',installPlanDigest:o.plan.installPlanDigest,
      installReceiptDigest:digest(Buffer.from(JSON.stringify(receipt,null,2)+'\n')),rootIdentity:receipt.rootIdentity} });
  const inputs = {plan,installReceipt:receipt,...Object.fromEntries(['archivePath','executablePath','stateRoot','budgetRoot','descriptorAdmission','probeAdmission','blueprintAdmission','buildContractAdmission','authorityRoot'].map(k=>[k,o[k]]))};
  await native.preflightNativeChatActivation(inputs);
  const journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
  for(const change of [x=>{x.installReceipt={...receipt,consumptionDigest:digest('forged')};},x=>{x.stateRoot+='-other';},
    x=>{x.descriptorAdmission={...x.descriptorAdmission};},x=>{x.plan={...plan,lifecycle:'install'};}]){
    const invalid={...inputs};change(invalid);await assert.rejects(native.preflightNativeChatActivation(invalid));
  }
  const file=path.join(o.stateRoot,'workspace','AGENTS.md'),original=await readFile(file);
  await writeFile(file,'changed');await assert.rejects(native.preflightNativeChatActivation(inputs));await writeFile(file,original);
  assert.deepEqual(await readFile(journal),before);
  const authority={authorityRoot:o.authorityRoot,stateRoot:o.stateRoot,plan,...decisions(plan,'activate')};
  const {unlink,chmod}=await import('node:fs/promises');
  for(const relative of ['.env','state/.env']){
    const extra=path.join(o.stateRoot,relative);await writeFile(extra,'SYNTHETIC_UNAPPROVED_INPUT=1\n',{mode:0o600});
    await assert.rejects(native.preflightNativeChatActivation(inputs));await unlink(extra);
  }
  await chmod(path.join(o.stateRoot,'state'),0o755);
  await assert.rejects(native.preflightNativeChatActivation(inputs));await chmod(path.join(o.stateRoot,'state'),0o700);
  assert.equal((await consumeNativeAuthoritySet(authority)).decisionCount,5);
  await assert.rejects(consumeNativeAuthoritySet(authority));
  await native.preflightNativeChatActivation(inputs);
});

it("starts the proxy before its own gateway and authenticates stop without exposing tokens", async t => {
  const { activationFixture, decisions }=await import('./helpers/native-chat-fixture.js');
  const native=await import('../src/native-chat-runtime.js');
  const { options:o }=await activationFixture(t);
  assert.equal(typeof native.startNativeChat,'function');assert.equal(typeof native.stopNativeChat,'function');
  const run=await native.startNativeChat(o);t.after(()=>run.stop());
  assert.equal(run.entry.url,`http://127.0.0.1:${o.plan.nativeBinding.gatewayPort}/chat?session=agent%3A${o.plan.nativeBinding.agentId}%3Amain`);
  assert.equal(run.entry.agentId,o.plan.nativeBinding.agentId);
  const control=JSON.parse(await readFile(path.join(o.stateRoot,'native-chat-control.json'),'utf8'));
  const token=await readFile(path.join(o.stateRoot,'native-chat-gateway-token'),'utf8');
  assert.ok(!JSON.stringify(run.entry).includes(token));assert.ok(!JSON.stringify(run.entry).includes(control.token));
  assert.equal((await lstat(path.join(o.stateRoot,'native-chat-control.json'))).mode&0o777,0o600);
  const denied=await fetch(`http://127.0.0.1:${control.port}/stop`,{method:'POST',headers:{authorization:'Bearer wrong'}});
  assert.equal(denied.status,401);assert.equal((await fetch(`http://127.0.0.1:${o.plan.nativeBinding.gatewayPort}/readyz`)).status,200);
  const malformed=await fetch(`http://127.0.0.1:${control.port}/stop`,{method:'POST',headers:{authorization:'Bearer '+'é'.repeat(64)},signal:AbortSignal.timeout(1000)});
  assert.equal(malformed.status,401);
  assert.deepEqual(await native.stopNativeChat({plan:o.plan,stateRoot:o.stateRoot}),{stopped:true});
  assert.equal((await run.completion).status,'stopped');
  await assert.rejects(lstat(path.join(o.stateRoot,'native-chat-control.json')),{code:'ENOENT'});
  await assert.rejects(native.startNativeChat(o));
  const restarted=await native.startNativeChat({...o,...decisions(o.plan,'restart')});t.after(()=>restarted.stop());
  assert.equal(await readFile(path.join(o.stateRoot,'native-chat-gateway-token'),'utf8'),token);
  await restarted.stop();assert.equal((await restarted.completion).status,'stopped');
});

it("rejects occupied ports, missing approval and unknown supervisor remnants before consumption", async t => {
  const { activationFixture }=await import('./helpers/native-chat-fixture.js');
  const native=await import('../src/native-chat-runtime.js');
  const {createServer}=await import('node:net');
  const { options:o }=await activationFixture(t);
  assert.equal(typeof native.startNativeChat,'function');
  const journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
  const controller=new AbortController();controller.abort();
  await assert.rejects(native.startNativeChat({...o,signal:controller.signal}),{code:'AGENTMO_NATIVE_ACTIVATION_CANCELLED'});
  assert.deepEqual(await readFile(journal),before);
  const occupied=createServer();await new Promise(resolve=>occupied.listen(o.plan.nativeBinding.gatewayPort,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>occupied.close(resolve)));
  await assert.rejects(native.startNativeChat(o));assert.deepEqual(await readFile(journal),before);
  await new Promise(resolve=>occupied.close(resolve));
  await assert.rejects(native.startNativeChat({...o,sensitiveDecisions:o.sensitiveDecisions.slice(1)}));
  assert.deepEqual(await readFile(journal),before);
  await writeFile(path.join(o.stateRoot,'native-chat-control.json'),'unknown',{mode:0o600});
  await assert.rejects(native.startNativeChat(o));await assert.rejects(native.stopNativeChat({plan:o.plan,stateRoot:o.stateRoot}));
  assert.equal(await readFile(path.join(o.stateRoot,'native-chat-control.json'),'utf8'),'unknown');
  assert.deepEqual(await readFile(journal),before);
});

it("a failed owned gateway closes its proxy, retains consumed authority, and never retries", async t => {
  const { activationFixture,gatewaySource }=await import('./helpers/native-chat-fixture.js');
  const native=await import('../src/native-chat-runtime.js');
  const { options:o }=await activationFixture(t,gatewaySource.replace("if(args[1]==='run'){","if(args[1]==='run'){process.exit(7);"));
  assert.equal(typeof native.startNativeChat,'function');
  const before=await readFile(path.join(o.authorityRoot,'consumption.jsonl'));
  await assert.rejects(native.startNativeChat(o));
  assert.notDeepEqual(await readFile(path.join(o.authorityRoot,'consumption.jsonl')),before);
  await assert.rejects(fetch(`http://127.0.0.1:${o.plan.nativeBinding.proxyPort}/v1/chat/completions`));
  await assert.rejects(native.startNativeChat(o));
});

for(const modelProfile of [undefined,'minimax-m3-cn-v1']) it(`owns installed ${nativeChatModelProfile(modelProfile).label} gateway in disposable state and restarts the exact installation`,{
  skip:process.env.AGENTMO_TEST_NATIVE_OPENCLAW!=='1',timeout:120_000,
},async t=>{
  const {activationFixture,decisions}=await import('./helpers/native-chat-fixture.js');
  const native=await import('../src/native-chat-runtime.js');
  const model=nativeChatModelProfile(modelProfile);
  const base='/Users/alexzhu/.local/lib/node_modules/openclaw';
  const {options:o}=await activationFixture(t,undefined,{executablePath:path.join(base,'openclaw.mjs'),packageJsonPath:path.join(base,'package.json'),buildInfoPath:path.join(base,'dist/build-info.json')},modelProfile);
  const {spawn}=await import('node:child_process');
  const {courseBudgetSummary}=await import('../src/course-wiki-budget.js');
  const requests=[],originalFetch=globalThis.fetch;let mode='success';
  t.mock.method(globalThis,'fetch',(url,options)=>{
    if(!String(url).startsWith('https:'))return originalFetch(url,options);
    assert.equal(url,model.endpoint);
    const wire=JSON.parse(options.body);requests.push(wire);
    assert.equal(wire.model,model.model);assert.equal(wire[model.outputLimitKey],2048);
    assert.deepEqual(wire.thinking,{type:'disabled'});
    if(modelProfile)assert.equal(wire.service_tier,'standard');
    if(mode==='timeout')throw new DOMException('Synthetic timeout','TimeoutError');
    if(mode!== 'success')return new Response('Synthetic failure',{status:mode});
    return new Response(`data: ${JSON.stringify({id:'synthetic',model:model.model,choices:[{index:0,delta:{content:'Synthetic owner is Amy.'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:4,total_tokens:24}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  });
  let run=await native.startNativeChat(o);t.after(()=>run.stop());
  assert.equal((await fetch(run.entry.url)).status,200);
  const token=await readFile(path.join(o.stateRoot,'native-chat-gateway-token'),'utf8');
  async function turn(session,message){
    const child=spawn(o.executablePath,['agent','--agent',o.plan.nativeBinding.agentId,'--session-id',session,'--thinking','off','--verbose','off','--timeout','15','--message',message,'--json'],
      {cwd:o.stateRoot,env:{...native.nativeChildEnvironment(o.stateRoot),OPENCLAW_GATEWAY_TOKEN:token,OPENCLAW_GATEWAY_PORT:String(o.plan.nativeBinding.gatewayPort),AGENTMO_NATIVE_PROXY_TOKEN:'unused-synthetic-client',OPENCLAW_NO_RESPAWN:'1',NODE_DISABLE_COMPILE_CACHE:'1'},stdio:['ignore','pipe','pipe']});
    try{return await native.settleNativeChild(child,{timeout:25_000,stop:()=>child.kill('SIGKILL')});}catch{return null;}
  }
  await turn('synthetic-thread-one','Synthetic meeting: owner is Amy.');
  assert.equal(requests.length,1,'one upstream request for the first native gateway turn');
  await turn('synthetic-thread-one','Synthetic follow-up: who is the owner?');
  assert.equal(requests.length,2);assert.ok(requests[1].messages.some(m=>m.role==='assistant'&&m.content.includes('Synthetic owner is Amy.')));
  assert.equal((await native.stopNativeChat({plan:o.plan,stateRoot:o.stateRoot})).stopped,true);
  assert.equal((await run.completion).status,'stopped');
  run=await native.startNativeChat({...o,...decisions(o.plan,'real-restart')});
  assert.equal((await fetch(run.entry.url)).status,200);
  await turn('synthetic-thread-one','Synthetic restored follow-up.');assert.equal(requests.length,3);
  assert.ok(requests[2].messages.some(m=>m.role==='assistant'&&m.content.includes('Synthetic owner is Amy.')));
  await turn('synthetic-thread-two','Synthetic independent meeting.');assert.equal(requests.length,4);
  assert.ok(!requests[3].messages.some(m=>m.role==='assistant'));
  for(mode of [401,429,500,'timeout']){
    const before=requests.length;
    await turn(`synthetic-failure-${mode}`,`Synthetic failure case ${mode}.`);
    assert.equal(requests.length,before+1,'failure cannot cause additional provider attempts');
  }
  assert.equal((await courseBudgetSummary({root:o.budgetRoot,budgetReference:o.plan.nativeBinding.budgetReference})).projectReservations,requests.length);
  await run.stop();assert.equal((await run.completion).status,'stopped');
});

it('rejects nested runtime-state links before consuming activation or touching external state',async t=>{
  const {activationFixture}=await import('./helpers/native-chat-fixture.js');
  const native=await import('../src/native-chat-runtime.js');
  const {mkdir,rename,symlink,link,unlink}=await import('node:fs/promises');
  const {root,options:o}=await activationFixture(t);
  const outside=path.join(root,'external-synthetic-state');await mkdir(outside,{mode:0o700});
  const sentinel=path.join(outside,'sentinel');await writeFile(sentinel,'unchanged synthetic state\n',{mode:0o600});
  await mkdir(path.join(o.stateRoot,'state','agents',o.plan.nativeBinding.agentId,'sessions'),{recursive:true,mode:0o700});
  const inputs=Object.fromEntries(['plan','archivePath','executablePath','stateRoot','budgetRoot','descriptorAdmission','probeAdmission','blueprintAdmission','buildContractAdmission','installReceipt','authorityRoot'].map(k=>[k,o[k]]));
  const journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
  for(const [i,relative] of ['state/agents',`state/agents/${o.plan.nativeBinding.agentId}/sessions`].entries()){
    const target=path.join(o.stateRoot,relative),saved=path.join(root,`saved-runtime-${i}`);
    await rename(target,saved);await symlink(outside,target);
    await assert.rejects(native.preflightNativeChatActivation(inputs));await assert.rejects(native.startNativeChat(o));
    assert.deepEqual(await readFile(journal),before);assert.equal(await readFile(sentinel,'utf8'),'unchanged synthetic state\n');
    for(const name of ['native-chat-gateway-token','native-chat-control.json'])await assert.rejects(lstat(path.join(o.stateRoot,name)),{code:'ENOENT'});
    await unlink(target);await rename(saved,target);
  }
  const alias=path.join(o.stateRoot,'state','agents',o.plan.nativeBinding.agentId,'sessions','linked-session');
  await link(sentinel,alias);await assert.rejects(native.preflightNativeChatActivation(inputs));await unlink(alias);
  await native.preflightNativeChatActivation(inputs);assert.deepEqual(await readFile(journal),before);
});
