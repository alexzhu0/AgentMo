import { createWorkspaceTools, revalidateWorkspace, revalidateWorkspaceOutput, workspaceTaskCase, publishWorkspaceArtifact, finishWorkspaceArtifact } from './pi-workspace-files.js';
import { validateWorkspaceHistory } from './pi-workspace-protocol.js';
import { workspaceSystemPrompt, piFinalText } from './pi-sdk.js';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { loadAdmittedArtifact, admittedArtifactProvenance } from './artifact-admission.js';
import { buildPiTargetDescriptor } from './pi-target-descriptor.js';
import { admitPiPackageArchive, buildPiInstallPlan, piPlanningSources, piArchiveSnapshot, piBytes, piHash, piIdentity, piKeys, piReject, readPiPrivateFile } from './pi-install-plan.js';
import { admitPiInstallReceipt, isPiInstallReceiptAdmission } from './pi-install.js';
import { consumeNativeAuthoritySet, verifyNativeAuthorityConsumption } from './native-chat-authority.js';
import { validatePiInstallApproval, validatePiSensitiveActionDecision, validatePiConflictApproval } from './pi-install-approval.js';
import { validateCourseBudgetBinding, courseBudgetSummary } from './course-wiki-budget.js';
import { createPiTurnController, startPiBudgetProxy, validatePiPublicTurn } from './pi-budget-proxy.js';
import { writeNativeChatFile } from './native-chat-files.js';
import { readBoundedNoFollowFile } from './builder-package.js';
import { resolveRuntimeEnv } from './runtime-env.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const INPUT_KEYS = ['planAdmission', 'sourceAdmissions', 'sourceFiles', 'stateRoot', 'authorityRoot', 'targetPaths', 'budgetRoot'];
const SOURCE_KEYS = ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive', 'installPlan', 'installReceipt', 'activationPlan'];
const snapshots = new WeakMap();
// Two full descriptor checks precede ready; shutdown also drains an in-flight check.
const OWNED_READY_TIMEOUT_MS = 300000;
const OWNED_STOP_TIMEOUT_MS = 300000;
const CHILD_STARTUP_STAGES = ['source-load', 'preflight', 'authority-consumption', 'control-files', 'sdk-import', 'session-prewarm', 'chat-listen'];
const STARTUP_CODES = ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'EADDRINUSE', 'PI_SDK_FAILURE',
  'AGENTMO_PI_RUNTIME_REJECTED', 'AGENTMO_PI_LIFECYCLE_REJECTED', 'AGENTMO_PI_TARGET_REJECTED', 'OTHER'];
const reject = () => { throw Object.assign(new Error('Pi runtime request rejected.'), { code: 'AGENTMO_PI_RUNTIME_REJECTED' }); };
const sourceSubject = { blueprint: 'blueprint', buildContract: 'build-contract', planApproval: 'plan-approval',
  targetDescriptor: 'pi-target-descriptor', targetCarrierAdmission: 'pi-target-carrier-admission', installPlan: 'pi-install-plan',
  installReceipt: 'pi-install-receipt', activationPlan: 'pi-install-plan' };
const planning = sources => Object.fromEntries(['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive'].map(k => [k, sources[k]]));

export async function runPiStartupStep(stage, operation, record) {
  if (!CHILD_STARTUP_STAGES.includes(stage)) reject();
  await record({ stage, state: 'starting', code: null });
  try {
    const result = await operation();
    await record({ stage, state: 'passed', code: null });
    return result;
  } catch (error) {
    await record({ stage, state: 'failed', code: STARTUP_CODES.includes(error?.code) ? error.code : 'OTHER' });
    throw error;
  }
}

export async function loadPiInstalledSources(options) {
  if (!piKeys(options, ['sourceFiles', 'stateRoot', 'authorityRoot'])) reject();
  const { sourceFiles, stateRoot, authorityRoot } = options;
  if (!piKeys(sourceFiles, SOURCE_KEYS.filter(k => k !== 'activationPlan'))
    || Object.values(sourceFiles).some(b => !piKeys(b, ['filePath', 'expectedDigest']))) reject();
  const sources = {};
  for (const k of ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor']) sources[k] = await loadAdmittedArtifact({ ...sourceFiles[k], subject: sourceSubject[k] });
  sources.targetCarrierAdmission = await loadAdmittedArtifact({ ...sourceFiles.targetCarrierAdmission, subject: sourceSubject.targetCarrierAdmission,
    companions: { blueprint: sources.blueprint, 'build-contract': sources.buildContract, 'plan-approval': sources.planApproval, 'pi-target-descriptor': sources.targetDescriptor } });
  sources.archive = await admitPiPackageArchive(sourceFiles.archive);
  sources.installPlan = await loadAdmittedArtifact({ ...sourceFiles.installPlan, subject: 'pi-install-plan' });
  sources.installReceipt = await admitPiInstallReceipt({ ...sourceFiles.installReceipt,
    admissions: { ...planning(sources), plan: sources.installPlan }, stateRoot, authorityRoot });
  return { sourceAdmissions: sources };
}

export async function loadPiNativeSources(options) {
  if (!piKeys(options, ['sourceFiles', 'stateRoot', 'authorityRoot']) || !piKeys(options.sourceFiles, SOURCE_KEYS)) reject();
  const { activationPlan, ...installedFiles } = options.sourceFiles;
  const { sourceAdmissions } = await loadPiInstalledSources({ ...options, sourceFiles: installedFiles });
  const planAdmission = await loadAdmittedArtifact({ ...activationPlan, subject: 'pi-install-plan' });
  return { planAdmission, sourceAdmissions };
}

export async function preflightPiNative(options) {
  if (!piKeys(options, INPUT_KEYS) || !piKeys(options.sourceAdmissions, SOURCE_KEYS.filter(k => k !== 'activationPlan'))) reject();
  const { planAdmission, sourceAdmissions, sourceFiles, stateRoot, authorityRoot, targetPaths, budgetRoot } = options;
  admittedArtifactProvenance(planAdmission, { subject: 'pi-install-plan', value: planAdmission.value });
  if (planAdmission.value.lifecycle !== 'activate' || !isPiInstallReceiptAdmission(sourceAdmissions.installReceipt)) reject();
  for (const k of SOURCE_KEYS.filter(k => !['archive', 'activationPlan'].includes(k))) {
    admittedArtifactProvenance(sourceAdmissions[k], { subject: sourceSubject[k], value: sourceAdmissions[k]?.value });
    if (sourceFiles?.[k]?.expectedDigest !== sourceAdmissions[k].digest) reject();
  }
  piPlanningSources(planning(sourceAdmissions));
  if (sourceFiles?.activationPlan?.expectedDigest !== planAdmission.digest
    || sourceFiles?.archive?.expectedDigest !== sourceAdmissions.archive.expectedDigest) reject();
  const fresh = await loadPiNativeSources({ sourceFiles, stateRoot, authorityRoot }), plan = fresh.planAdmission.value;
  if (fresh.planAdmission.digest !== planAdmission.digest || !isDeepStrictEqual(plan, planAdmission.value)
    || !isDeepStrictEqual(await buildPiTargetDescriptor(targetPaths), fresh.sourceAdmissions.targetDescriptor.value)) reject();
  const expected = buildPiInstallPlan({ lifecycle: 'activate', admissions: planning(fresh.sourceAdmissions), stateRoot,
    authorityRootBinding: plan.authorityRootBinding, budgetReference: plan.nativeBinding.budgetReference,
    ports: { chat: plan.nativeBinding.chatPort, proxy: plan.nativeBinding.proxyPort }, predecessor: fresh.sourceAdmissions.installReceipt,
    activationId: plan.activationId, approvedCases: plan.approvedCases, restartAllowance: plan.restartAllowance });
  if (!isDeepStrictEqual(expected, plan)) reject();
  await validateCourseBudgetBinding({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
  for (const sessionId of new Set(plan.approvedCases.map(c => c.sessionId))) {
    const dir = path.join(stateRoot, 'sessions', sessionId), stat = await lstat(dir, { bigint: true });
    const registration = JSON.parse((await readPiPrivateFile(path.join(dir, 'registration.json'))).bytes);
    if (!piKeys(registration, ['schemaVersion', 'id', 'createdAt', 'bindingDigest', 'rootIdentity', 'directoryIdentity'])
      || registration.schemaVersion !== 'agentmo.pi-session-registration.v1' || registration.id !== sessionId
      || registration.bindingDigest !== piHash(piBytes(plan.nativeBinding)) || !isDeepStrictEqual(registration.directoryIdentity, piIdentity(stat))
      || !isDeepStrictEqual(registration.rootIdentity, plan.predecessor.rootIdentity) || !stat.isDirectory() || stat.isSymbolicLink()
      || stat.uid !== BigInt(process.getuid()) || (stat.mode & 0o777n) !== 0o700n) reject();
  }
  const result = Object.freeze({ schemaVersion: 'agentmo.pi-native-preflight.v1', activationPlanDigest: plan.installPlanDigest,
    nativeBindingDigest: piHash(piBytes(plan.nativeBinding)), modelRequests: 0 });
  snapshots.set(result, fresh); return result;
}

export function piChildEnvironment(stateRoot, nodeExecutablePath) {
  if (!path.isAbsolute(stateRoot) || path.resolve(stateRoot) !== stateRoot || !path.isAbsolute(nodeExecutablePath)) reject();
  return { PATH: `${path.dirname(nodeExecutablePath)}:/usr/bin:/bin`, HOME: stateRoot, TMPDIR: path.join(stateRoot, 'attempts'),
    PI_CODING_AGENT_DIR: stateRoot, PI_CODING_AGENT_SESSION_DIR: path.join(stateRoot, 'sessions'), PI_OFFLINE: '1', PI_TELEMETRY: '0',
    PI_SKIP_VERSION_CHECK: '1', NODE_DISABLE_COMPILE_CACHE: '1', AGENTMO_PI_CHILD: '1' };
}

function assertDecisions(plan, options) {
  const context = { plan, now: new Date().toISOString() };
  if (!validatePiInstallApproval(options.ordinaryApproval, context).ok || !validatePiConflictApproval(options.conflictApproval, context).ok
    || !Array.isArray(options.sensitiveDecisions) || options.sensitiveDecisions.length !== plan.sensitiveActions.length
    || options.sensitiveDecisions.some((d, i) => !validatePiSensitiveActionDecision(d, { ...context, action: plan.sensitiveActions[i] }).ok)) reject();
}
const basePath = (stateRoot, plan, index) => path.join(stateRoot, 'attempts', `pi-run-${plan.installPlanDigest.slice(7)}-${index}`);
async function existing(filePath) { try { return JSON.parse((await readPiPrivateFile(filePath)).bytes); } catch (e) { if (e.code !== 'ENOENT') throw e; return null; } }
function validStop(value, plan, runId) {
  return piKeys(value, ['schemaVersion', 'activationPlanDigest', 'runId', 'rootIdentity', 'status', 'reason', 'ownChildExited'])
    && value.schemaVersion === 'agentmo.pi-owned-stop.v1' && value.activationPlanDigest === plan.installPlanDigest && value.runId === runId
    && isDeepStrictEqual(value.rootIdentity, plan.predecessor.rootIdentity) && ['stopped', 'failed'].includes(value.status)
    && ['requested', 'signal', 'child-exit', 'child-error', 'protocol-failed', 'case-failed', 'startup-failed'].includes(value.reason)
    && typeof value.ownChildExited === 'boolean';
}
async function nextRun(stateRoot, plan, authorityRoot) {
  for (const name of (await readdir(path.join(stateRoot, 'attempts'))).filter(n=>n.startsWith('pi-run-')&&n.endsWith('.claim.json'))) {
    const match=/^pi-run-([a-f0-9]{64})-([01])\.claim\.json$/u.exec(name);if(!match)reject();
    if(`sha256:${match[1]}`===plan.installPlanDigest)continue;
    const base=path.join(stateRoot,'attempts',name.slice(0,-11));
    const claim=JSON.parse((await readPiPrivateFile(path.join(stateRoot,'attempts',name))).bytes);
    const stopped=JSON.parse((await readPiPrivateFile(`${base}.stopped.json`)).bytes);
    if(!piKeys(claim,['runId','activationPlanDigest','index','rootIdentity','consumptionDigest'])
      ||!UUID.test(claim.runId)||claim.activationPlanDigest!==`sha256:${match[1]}`
      ||claim.index!==Number(match[2])||!/^sha256:[a-f0-9]{64}$/u.test(claim.consumptionDigest)
      ||!isDeepStrictEqual(claim.rootIdentity,plan.predecessor.rootIdentity)
      ||!validStop(stopped,{installPlanDigest:claim.activationPlanDigest,predecessor:plan.predecessor},claim.runId)||!stopped.ownChildExited)reject();
  }

  for (let index = 0; index <= plan.restartAllowance; index++) {
    const base = basePath(stateRoot, plan, index), prior = await existing(`${base}.claim.json`);
    if (!prior) return { base, index };
    const stopped = await existing(`${base}.stopped.json`);
    if (!piKeys(prior, ['runId', 'activationPlanDigest', 'index', 'rootIdentity', 'consumptionDigest'])
      || prior.activationPlanDigest !== plan.installPlanDigest || prior.index !== index || !UUID.test(prior.runId)
      || !isDeepStrictEqual(prior.rootIdentity, plan.predecessor.rootIdentity) || !validStop(stopped, plan, prior.runId)
      || stopped.status !== 'stopped' || stopped.reason !== 'requested' || stopped.ownChildExited !== true) reject();
    await verifyNativeAuthorityConsumption({ authorityRoot, plan, consumptionDigest: prior.consumptionDigest });
  }
  reject();
}
function send(child, value) {
  return new Promise((resolve, rejectSend) => {
    if (!child.connected) return rejectSend(new Error('owned channel closed'));
    child.send(value, error => error ? rejectSend(new Error('owned channel failed')) : resolve());
  });
}
async function deadline(promise, ms) {
  let timer; try { return await Promise.race([promise, new Promise((_, rejectTimer) => { timer = setTimeout(() => rejectTimer(new Error('owned operation timed out')), ms); })]); }
  finally { clearTimeout(timer); }
}

export async function readPiWorkspaceHistory({binding,sessionId,snapshot,stateRoot}) {
  if(!UUID.test(sessionId) || !binding.pi_workspace || piHash(stateRoot)!==binding.stateRootDigest)reject();
  const sessionDir=path.join(stateRoot,'sessions',sessionId),identity={sessionId,bindingDigest:piHash(piBytes(binding)),
    snapshotDigest:snapshot.snapshotDigest,skillDigest:binding.pi_workspace.skill.digest};
  const prior=await existing(path.join(sessionDir,'workspace-binding.json'));
  if(prior && !isDeepStrictEqual(prior,identity))reject();
  const meta=await existing(path.join(sessionDir,'sdk-session.json')),records=[],tasks=[];
  let entries=[];
  if(meta){
    if(!prior || meta.sessionId!==sessionId || meta.bindingDigest!==identity.bindingDigest || path.basename(meta.fileName)!==meta.fileName)reject();
    const bytes=(await readPiPrivateFile(path.join(sessionDir,meta.fileName))).bytes;
    const raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);if(!raw.endsWith('\n'))reject();
    const all=raw.trimEnd().split('\n').map(JSON.parse);
    if(all[0]?.type!=='session' || all[0].id!==sessionId || all[0].cwd!==stateRoot)reject();entries=all.slice(1);
  }
  for(const name of await readdir(path.join(stateRoot,'attempts'))){
    if(!/^pi-workspace-[a-f0-9-]{36}$/u.test(name))continue;
    const base=path.join(stateRoot,'attempts',name),task=await existing(path.join(base,'task.json'));
    if(!task || task.sessionId!==sessionId)continue;
    if(!piKeys(task,['schemaVersion','taskId','sessionId','bindingDigest','snapshotDigest','skillDigest','inputDigest'])
      || task.schemaVersion!=='agentmo.pi-workspace-task.v1' || !UUID.test(task.taskId) || name!==`pi-workspace-${task.taskId}`
      || task.bindingDigest!==identity.bindingDigest || task.snapshotDigest!==identity.snapshotDigest || task.skillDigest!==identity.skillDigest
      || !/^sha256:[a-f0-9]{64}$/u.test(task.inputDigest))reject();
    const complete=await existing(path.join(base,'result.json')),saved=await existing(path.join(base,'tool-records.json'));
    if(!meta || !complete || complete.taskId!==task.taskId || complete.sessionId!==sessionId || complete.status!=='passed'
      || complete.cleanup!=='stopped' || complete.publication!=='published' || complete.snapshotDigest!==identity.snapshotDigest
      || complete.skillDigest!==identity.skillDigest || complete.agentDigest!==binding.packageArchiveDigest
      || !piKeys(saved,['taskId','sessionId','turnId','finalEntryId','records']) || saved.taskId!==task.taskId || saved.sessionId!==sessionId
      || !UUID.test(saved.turnId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(saved.finalEntryId) || !Array.isArray(saved.records)
      || saved.records.some(r=>r.taskId!==task.taskId || r.sessionId!==sessionId || r.snapshotDigest!==identity.snapshotDigest || r.skillDigest!==identity.skillDigest || !['read','write'].includes(r.name))
      || saved.records.filter(r=>r.name==='write').length!==1 || complete.tools!==saved.records.length
      || saved.records.find(r=>r.name==='write').result.contentDigest!==complete.contentDigest)reject();
    const completion=await existing(path.join(stateRoot,'turns',`${saved.turnId}.completed.json`));
    if(!completion || completion.sessionId!==sessionId || completion.finalEntryId!==saved.finalEntryId || completion.status!=='completed' || completion.bindingDigest!==identity.bindingDigest)reject();
    tasks.push({task,saved});records.push(...saved.records.map(r=>({...r,taskStatus:'passed'})));
  }
  // Every native user/final segment must belong to one successful task, including zero-tool histories.
  let input=null,calls=[];const used=new Set();
  for(const entry of entries){
    if(entry.type!=='message')continue;const m=entry.message;
    if(m?.role==='user'){
      if(input!==null)reject();
      input=typeof m.content==='string'?m.content:Array.isArray(m.content)&&m.content.every(p=>p.type==='text'&&typeof p.text==='string')?m.content.map(p=>p.text).join(''):null;
      if(input===null)reject();calls=[];
    }
    if(m?.role==='assistant'){
      if(Array.isArray(m.content))calls.push(...m.content.filter(p=>p.type==='toolCall').map(p=>p.id));
      if(m.rawStopReason==='end_turn'){
        const owner=tasks.find(t=>t.saved.finalEntryId===entry.id);
        if(!owner || used.has(owner.task.taskId) || input===null || piHash(input)!==owner.task.inputDigest
          || !isDeepStrictEqual(calls,owner.saved.records.map(r=>r.toolCallId)))reject();
        piFinalText(m);used.add(owner.task.taskId);input=null;calls=[];
      }
    }
  }
  if(input!==null || used.size!==tasks.length)reject();
  validateWorkspaceHistory({entries,binding:identity,toolRecords:records});
  return {sessionDir,identity,prior,entries,records,historyDigest:piHash(JSON.stringify({entries,records,identity}))};
}

// The owned parent alone holds source bytes and executes tools. The child gets logical names and exact results.
export async function createPiWorkspaceBridge({ binding, workspace, stateRoot, signal }) {
  const { taskId,sessionId,snapshot,attemptRoot,deadline }=workspace;
  if(!binding.pi_workspace || !UUID.test(taskId) || !UUID.test(sessionId) || !Number.isFinite(deadline)
    || deadline<=Date.now() || deadline>Date.now()+600000 || signal?.aborted
    || attemptRoot!==path.join(stateRoot,'attempts',`pi-workspace-${taskId}`))reject();
  await revalidateWorkspace({snapshot});
  const {sessionDir,identity,prior,entries,records,historyDigest}=await readPiWorkspaceHistory({binding,sessionId,snapshot,stateRoot});
  if(workspace.historyDigest!==undefined && workspace.historyDigest!==historyDigest)reject();
  await writeNativeChatFile({filePath:path.join(attemptRoot,'task.json'),bytes:Buffer.from(JSON.stringify({schemaVersion:'agentmo.pi-workspace-task.v1',taskId,sessionId,bindingDigest:identity.bindingDigest,snapshotDigest:identity.snapshotDigest,skillDigest:identity.skillDigest,inputDigest:piHash(workspace.approvedText)}))});
  if(!prior)await writeNativeChatFile({filePath:path.join(sessionDir,'workspace-binding.json'),bytes:Buffer.from(JSON.stringify(identity))});
  const sources=snapshot.sources.map(({sourceId,logicalPath})=>({sourceId,logicalPath}));
  const taskBinding={taskId,sessionId,snapshotDigest:snapshot.snapshotDigest,policy:binding.pi_workspace};
  const tools=createWorkspaceTools({binding:taskBinding,snapshot,attemptRoot,signal,admittedHistoryRecords:records.filter(r=>r.name==='read')});
  const check=()=>{if(signal?.aborted || Date.now()>=deadline) {tools.close();reject();}};
  const systemPrompt=workspaceSystemPrompt(new TextDecoder('utf-8',{fatal:true}).decode((await readPiPrivateFile(path.join(stateRoot,'system.md'))).bytes),binding.pi_workspace,sources);
  const historyMessages=[];
  for(const {message:m} of entries.filter(e=>e.type==='message')){
    if(m.role==='system')continue;
    if(m.role==='toolResult'){
      const p={type:'tool_result',tool_use_id:m.toolCallId,content:m.content,is_error:false};
      const last=historyMessages.at(-1);
      if(last?.role==='user' && Array.isArray(last.content) && last.content.every(p=>p.type==='tool_result'))last.content.push(p);
      else historyMessages.push({role:'user',content:[p]});
    }else historyMessages.push({role:m.role,content:typeof m.content==='string'?m.content:m.content.map(p=>p.type==='text'?{type:'text',text:p.text}:{type:'tool_use',id:p.id,name:p.name,input:p.arguments})});
  }
  return {
    controller:{binding:{...taskBinding,systemPrompt,historyMessages},approvedText:workspace.approvedText,deadline,records:()=>[...records,...tools.records]},
    context(input){check();if(!piKeys(input,['sessionId']) || input.sessionId!==sessionId)reject();return {...taskBinding,sources,records:structuredClone(records)};},
    async execute(input){check();if(Buffer.byteLength(JSON.stringify(input))>16384)reject();return tools.execute(input);},
    async complete(input){check();if(input?.sessionId!==sessionId || !UUID.test(input.turnId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.finalEntryId))reject();await writeNativeChatFile({filePath:path.join(attemptRoot,'tool-records.json'),bytes:Buffer.from(JSON.stringify({taskId,sessionId,turnId:input.turnId,finalEntryId:input.finalEntryId,records:tools.records}))});},
    get staged(){return tools.staged;}, get count(){return tools.count;}, close:()=>tools.close(),
  };
}

export async function startPiNative(options) {
  const optional = ['apiKey', 'runtimeEnvFile', 'signal', 'workspace'].filter(k => Object.hasOwn(options ?? {}, k));
  if (!piKeys(options, [...INPUT_KEYS, 'ordinaryApproval', 'sensitiveDecisions', 'conflictApproval', 'approvedCases', ...optional])
    || options.apiKey !== undefined && options.runtimeEnvFile !== undefined || options.signal?.aborted) reject();
  const preflightArgs = Object.fromEntries(INPUT_KEYS.map(k => [k, options[k]]));
  const snapshot = await preflightPiNative(preflightArgs), fresh = snapshots.get(snapshot), plan = fresh.planAdmission.value;
  if (!isDeepStrictEqual(options.approvedCases, plan.approvedCases)
    || options.runtimeEnvFile !== undefined && (!plan.approvedCases.length || !path.isAbsolute(options.runtimeEnvFile))
    || options.apiKey !== undefined && (typeof options.apiKey !== 'string' || !options.apiKey || /[\r\n]/u.test(options.apiKey))) reject();
  if(plan.nativeBinding.pi_workspace && plan.approvedCases.length){
    if(!options.workspace || plan.restartAllowance!==0 || !isDeepStrictEqual(plan.approvedCases,[workspaceTaskCase({binding:plan.nativeBinding,workspace:options.workspace})]))reject();
    await revalidateWorkspace({snapshot:options.workspace.snapshot});await revalidateWorkspaceOutput(options.workspace.output);
    const history=await readPiWorkspaceHistory({binding:plan.nativeBinding,sessionId:options.workspace.sessionId,snapshot:options.workspace.snapshot,stateRoot:options.stateRoot});
    if(history.historyDigest!==options.workspace.historyDigest)reject();
  }else if(options.workspace)reject();
  assertDecisions(plan, options);
  const { stateRoot, authorityRoot, budgetRoot } = options, { base, index } = await nextRun(stateRoot, plan, authorityRoot), runId = randomUUID();
  const budgetBefore = await courseBudgetSummary({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
  if (options.signal?.aborted) reject();
  const consumed = await consumeNativeAuthoritySet({ authorityRoot, stateRoot, plan, ordinaryApproval: options.ordinaryApproval,
    sensitiveDecisions: options.sensitiveDecisions, conflictApproval: options.conflictApproval });
  let workspaceBridge, workspaceTimer, proxy, child, stopping, closing = false, resolveCompletion, key = '', ownChildExited = true;
  const completion = new Promise(resolve => { resolveCompletion = resolve; });
  let childExit = Promise.resolve({ code: 0 });
  const stop = (reason = 'requested') => {
    if (stopping) return stopping;
    closing = true;
    clearTimeout(workspaceTimer);workspaceBridge?.close();
    stopping = (async () => {
      let clean = true;
      try { await proxy?.close(); } catch { clean = false; }
      if (child) {
        if (child.connected) await send(child, { type: 'shutdown', runId }).catch(() => { clean = false; });
        try { const result = await deadline(childExit, OWNED_STOP_TIMEOUT_MS); ownChildExited = true; if (result.code !== 0) clean = false; }
        catch { clean = false; ownChildExited = false; }
      }
      key = '';
      const result = { schemaVersion: 'agentmo.pi-owned-stop.v1', activationPlanDigest: plan.installPlanDigest, runId,
        rootIdentity: plan.predecessor.rootIdentity, status: clean && reason === 'requested' ? 'stopped' : 'failed', reason, ownChildExited };
      await writeNativeChatFile({ filePath: `${base}.stopped.json`, bytes: piBytes(result) }).catch(() => { result.status = 'failed'; });
      options.signal?.removeEventListener('abort', cancelled); resolveCompletion(result); return result;
    })(); return stopping;
  };
  const cancelled = () => { void stop('signal'); };
  try {
    await writeNativeChatFile({ filePath: `${base}.claim.json`, bytes: piBytes({ runId, activationPlanDigest: plan.installPlanDigest,
      index, rootIdentity: plan.predecessor.rootIdentity, consumptionDigest: consumed.consumptionDigest }) });
    if (options.signal?.aborted) throw new Error('cancelled');
    if (options.runtimeEnvFile) {
      const env = resolveRuntimeEnv({ envFile: options.runtimeEnvFile,
        envFileContent: new TextDecoder('utf-8', { fatal: true }).decode(await readBoundedNoFollowFile(options.runtimeEnvFile, 64 * 1024)), runtimeEnvAllowlist: ['MINIMAX_API_KEY'] });
      key = env.values.MINIMAX_API_KEY; env.values.MINIMAX_API_KEY = ''; env.secretValues.length = 0;
    } else key = options.apiKey ?? (plan.approvedCases.length ? '' : 'unavailable-in-read-only-mode');
    if (!key || /[\r\n]/u.test(key)) throw new Error('missing credential');
    const loginSecret = randomBytes(24).toString('hex'), stopCapability = randomBytes(32).toString('hex');
    const control = { schemaVersion: 'agentmo.pi-owned-control.v1', runId, activationPlanDigest: plan.installPlanDigest,
      rootIdentity: plan.predecessor.rootIdentity, chatPort: plan.nativeBinding.chatPort, stopCapability };
    const controlBytes = Buffer.from(`${JSON.stringify(control)}\n`);
    await writeNativeChatFile({ filePath: `${base}.control.json`, bytes: controlBytes });
    await writeNativeChatFile({ filePath: `${base}.login.txt`, bytes: Buffer.from(loginSecret) });
    if(options.workspace) {
      workspaceBridge=await createPiWorkspaceBridge({binding:plan.nativeBinding,workspace:options.workspace,stateRoot,signal:options.signal});
      workspaceTimer=setTimeout(()=>{void stop('case-failed');},Math.max(1,options.workspace.deadline-Date.now()));
    }
    const controller = await createPiTurnController({ binding: plan.nativeBinding, stateRoot, approvedCases: plan.approvedCases, activationId: plan.activationId, ...(workspaceBridge?{workspace:workspaceBridge.controller}:{}) });
    proxy = await startPiBudgetProxy({ binding: plan.nativeBinding, stateRoot, budgetRoot, apiKey: key, controller }); key = '';
    let readyResolve, readyReject, becameReady = false;
    const ready = new Promise((resolve, rejectReady) => { readyResolve = resolve; readyReject = rejectReady; });
    ready.catch(() => {});
    child = spawn(options.targetPaths.nodeExecutablePath, [fileURLToPath(import.meta.url), '--pi-owned-child'], {
      cwd: stateRoot, env: piChildEnvironment(stateRoot, options.targetPaths.nodeExecutablePath), shell: false, stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
    }); ownChildExited = false;
    childExit = new Promise(resolve => { child.once('exit', (code, signal) => { resolve({ code, signal }); if (!closing) void stop('child-exit'); });
      child.once('error', () => { readyReject(new Error('owned child failed')); resolve({ code: 1 }); if (!closing) void stop('child-error'); }); });
    const seen = new Set(); let workspaceTurnId = null, startupSequence = 0, startupFailed = false;
    child.on('message', message => {
      void (async () => {
        if (message?.type === 'startup') {
          if (becameReady || startupFailed || !piKeys(message, ['type', 'runId', 'sequence', 'stage', 'state', 'code'])
            || message.runId !== runId || message.sequence !== startupSequence || startupSequence >= 14
            || message.stage !== CHILD_STARTUP_STAGES[Math.floor(startupSequence / 2)]
            || (startupSequence % 2 === 0 ? message.state !== 'starting' || message.code !== null
              : message.state === 'passed' ? message.code !== null : message.state !== 'failed' || !STARTUP_CODES.includes(message.code))) reject();
          startupSequence++; startupFailed = message.state === 'failed';
          child.emit('agentmo-pi-startup', { sequence: message.sequence, stage: message.stage, state: message.state, code: message.code });
          return;
        }
        if (message?.type === 'ready') {
          if (becameReady || !piKeys(message, ['type', 'runId', 'agentId', 'chatPort']) || message.runId !== runId
            || message.agentId !== plan.nativeBinding.agentId || message.chatPort !== plan.nativeBinding.chatPort
            || startupFailed || startupSequence !== 0 && startupSequence !== 14) reject();
          becameReady = true; readyResolve(); return;
        }
        if (!piKeys(message, ['type', 'runId', 'requestId', 'method', 'input']) || message.type !== 'call' || message.runId !== runId
          || !UUID.test(message.requestId) || seen.has(message.requestId) || seen.size >= 50000
          || !['admit', 'finish', 'state', 'status', 'stop', 'workspace', 'tool'].includes(message.method)) reject();
        seen.add(message.requestId);
        let value;
        try {
          if (message.method === 'admit') { if (closing) reject(); value = await controller.admit(message.input); if(workspaceBridge && value.kind==='admitted')workspaceTurnId=message.input.turnId; }
          else if (message.method === 'finish') { if(workspaceBridge && message.input?.status==='completed')await workspaceBridge.complete(message.input); value = await controller.finish(message.input); }
          else if(message.method==='workspace'){if(closing || !workspaceBridge)reject();value=workspaceBridge.context(message.input);}
          else if(message.method==='tool'){if(closing || !workspaceBridge || !workspaceTurnId)reject();const state=await controller.state(workspaceTurnId);if(!['received','reserved','sent'].includes(state.status))reject();value=await workspaceBridge.execute(message.input);}
          else if (message.method === 'state') { if (!piKeys(message.input, ['turnId'])) reject(); value = await controller.state(message.input.turnId); }
          else if (message.method === 'status') { if (!piKeys(message.input, [])) reject(); value = closing ? { canSend: false, nextCaseId: null } : await controller.status(); }
          else { if (!piKeys(message.input, [])) reject(); value = { stopping: true }; }
          await send(child, { type: 'result', runId, requestId: message.requestId, ok: true, value });
        } catch { await send(child, { type: 'result', runId, requestId: message.requestId, ok: false, value: null }); return; }
        if (message.method === 'stop') setImmediate(() => { void stop(); });
        if (message.method === 'finish' && value.status !== 'completed') setImmediate(() => { void stop('case-failed'); });
      })().catch(() => { readyReject(new Error('owned protocol failed')); void stop('protocol-failed'); });
    });
    await send(child, { type: 'init', runId, sourceFiles: options.sourceFiles, targetPaths: options.targetPaths, stateRoot, authorityRoot, budgetRoot,
      controlPath: `${base}.control.json`, controlDigest: piHash(controlBytes), loginPath: `${base}.login.txt`, consumptionDigest: consumed.consumptionDigest });
    options.signal?.addEventListener('abort', cancelled, { once: true });
    if (options.signal?.aborted) cancelled();
    await deadline(Promise.race([ready, completion.then(() => { throw new Error('owned startup stopped'); })]), OWNED_READY_TIMEOUT_MS);
    if (closing || options.signal?.aborted) throw new Error('startup stopped');
    const health = await fetch(`http://127.0.0.1:${plan.nativeBinding.chatPort}/`, { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const expectedHtml = piArchiveSnapshot(fresh.sourceAdmissions.archive).files.find(f => f.relativePath === 'browser/index.html');
    if (health.status !== 200 || !(health.headers.get('content-security-policy') ?? '').includes("frame-ancestors 'none'")
      || piHash(Buffer.from(await health.text())) !== expectedHtml.sha256 || closing || options.signal?.aborted) throw new Error('health failed');
    const budgetAfter = await courseBudgetSummary({ root: budgetRoot, budgetReference: plan.nativeBinding.budgetReference });
    if (budgetAfter.projectReservations !== budgetBefore.projectReservations || proxy.summary().modelRequests !== 0
      || proxy.summary().proxyRequests !== 0) throw new Error('unexpected startup request');
    let artifact;
    const artifactBinding=workspaceBridge?{...options.workspace,policy:plan.nativeBinding.pi_workspace,
      snapshotDigest:options.workspace.snapshot.snapshotDigest,agentDigest:plan.nativeBinding.packageArchiveDigest}:null;
    const workspaceOperations=workspaceBridge?{
      workspaceSummary:()=>proxy.summary(),
      async publishWorkspace({sessionId,turnId}){
        if(closing || artifact || sessionId!==options.workspace.sessionId)reject();
        const state=await controller.state(turnId);if(state.status!=='completed' || state.sessionId!==sessionId)reject();
        const completion=await existing(path.join(stateRoot,'turns',`${turnId}.completed.json`));
        const meta=await existing(path.join(stateRoot,'sessions',sessionId,'sdk-session.json'));
        if(!meta || path.basename(meta.fileName)!==meta.fileName)reject();
        const raw=new TextDecoder('utf-8',{fatal:true}).decode((await readPiPrivateFile(path.join(stateRoot,'sessions',sessionId,meta.fileName))).bytes);
        const entry=raw.trimEnd().split('\n').map(JSON.parse).find(e=>e.id===completion.finalEntryId);
        const counts=proxy.summary();
        artifact=await publishWorkspaceArtifact({binding:artifactBinding,staged:workspaceBridge.staged,finalReply:piFinalText(entry?.message),sessionDurable:true,
          taskState:{status:'completed',activeRequests:0,toolsBusy:false,skillInContext:true,requests:counts.modelRequests,tools:workspaceBridge.count,reservations:counts.newReservations},signal:options.signal});
        return artifact;
      },
      async finalizeWorkspace(){if(!artifact || !stopping)reject();const stopResult=await stopping;
        return finishWorkspaceArtifact({binding:artifactBinding,manifest:artifact,cleanup:stopResult.status==='stopped'&&stopResult.ownChildExited?'stopped':'failed'});}
    }:{};
    return { entry: { schemaVersion: 'agentmo.pi-native-entry.v1', agentId: plan.nativeBinding.agentId,
      activationPlanDigest: plan.installPlanDigest, url: `http://127.0.0.1:${plan.nativeBinding.chatPort}/`, accessFile: `${base}.login.txt`,
      canSend: (await controller.status()).canSend, modelRequests: 0, newReservations: 0 }, completion, stop: () => stop(), ...workspaceOperations };
  } catch { await stop('startup-failed'); reject(); }
}

export async function stopPiNative({ planAdmission, stateRoot }) {
  admittedArtifactProvenance(planAdmission, { subject: 'pi-install-plan', value: planAdmission.value });
  const plan = planAdmission.value;
  if (plan.lifecycle !== 'activate' || piHash(stateRoot) !== plan.nativeBinding.stateRootDigest
    || !isDeepStrictEqual(piIdentity(await lstat(stateRoot, { bigint: true })), plan.predecessor.rootIdentity)) reject();
  for (let index = plan.restartAllowance; index >= 0; index--) {
    const base = basePath(stateRoot, plan, index), claim = await existing(`${base}.claim.json`); if (!claim) continue;
    const prior = await existing(`${base}.stopped.json`);
    if (prior) { if (!validStop(prior, plan, claim.runId) || prior.status !== 'stopped' || prior.ownChildExited !== true) reject(); return prior; }
    const control = await existing(`${base}.control.json`);
    if (!piKeys(control, ['schemaVersion', 'runId', 'activationPlanDigest', 'rootIdentity', 'chatPort', 'stopCapability'])
      || control.schemaVersion !== 'agentmo.pi-owned-control.v1' || control.runId !== claim.runId || !UUID.test(control.runId)
      || control.activationPlanDigest !== plan.installPlanDigest || control.chatPort !== plan.nativeBinding.chatPort
      || !isDeepStrictEqual(control.rootIdentity, plan.predecessor.rootIdentity) || !/^[a-f0-9]{64}$/u.test(control.stopCapability)) reject();
    await fetch(`http://127.0.0.1:${control.chatPort}/api/stop`, { method: 'POST', headers: { 'content-type': 'application/json',
      authorization: `AgentMoStop ${control.stopCapability}` }, body: '{}', redirect: 'error', signal: AbortSignal.timeout(5000) }).catch(() => {});
    for (let n = 0; n < OWNED_STOP_TIMEOUT_MS / 100; n++) {
      let stopped;
      try { stopped = await existing(`${base}.stopped.json`); }
      catch (error) {
        // A create-only receipt can still be writing; never accept it without a complete strict read.
        if (error.code !== 'AGENTMO_PI_LIFECYCLE_REJECTED' && !(error instanceof SyntaxError)) throw error;
      }
      if (stopped) { if (!validStop(stopped, plan, control.runId) || stopped.status !== 'stopped' || stopped.ownChildExited !== true) reject(); return stopped; }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    reject();
  }
  reject();
}

async function runOwnedPiChild() {
  if (typeof process.send !== 'function' || !process.connected || process.env.AGENTMO_PI_CHILD !== '1'
    || ['MINIMAX_API_KEY', 'OPENAI_API_KEY', 'DEEPSEEK_API_KEY', 'NODE_OPTIONS', 'HTTP_PROXY', 'HTTPS_PROXY'].some(k => Object.hasOwn(process.env, k))) reject();
  process.umask(0o077);
  let runId, starting = false, host, server, closing = false, closed = false, shutdown;
  let initialization = Promise.resolve();
  const pending = new Map();
  const call = (method, input) => {
    if (!runId || !process.connected || closed || closing && method !== 'finish') return Promise.reject(new Error('owned channel unavailable'));
    const requestId = randomUUID();
    return new Promise((resolve, rejectCall) => {
      const timer = setTimeout(() => { pending.delete(requestId); rejectCall(new Error('owned call timed out')); }, 30000);
      pending.set(requestId, { method, resolve: value => { clearTimeout(timer); resolve(value); }, reject: () => { clearTimeout(timer); rejectCall(new Error('owned call rejected')); } });
      process.send({ type: 'call', runId, requestId, method, input }, error => { if (error) { pending.get(requestId)?.reject(); pending.delete(requestId); } });
    });
  };
  const close = (failed = false) => {
    if (failed) process.exitCode = 1;
    closing = true;
    return shutdown ??= (async () => {
      await initialization.catch(() => {});
      await server?.close().catch(() => { process.exitCode = 1; });
      await host?.close().catch(() => { process.exitCode = 1; });
      closed = true; for (const request of pending.values()) request.reject(); pending.clear();
      if (process.connected) process.disconnect();
    })();
  };
  const validResult = (method, value) => {
    if(method==='workspace')return piKeys(value,['taskId','sessionId','snapshotDigest','policy','sources','records']) && UUID.test(value.taskId) && UUID.test(value.sessionId) && Array.isArray(value.sources) && value.sources.length>=1 && value.sources.length<=2 && Array.isArray(value.records) && Buffer.byteLength(JSON.stringify(value))<=524288;
    if(method==='tool')return (piKeys(value,['sourceId','contentDigest','startLine','endLine','text']) && typeof value.text==='string' && Buffer.byteLength(value.text)<=4096)
      || (piKeys(value,['status','contentDigest','byteLength','citations']) && value.status==='staged' && value.byteLength<=8192 && Array.isArray(value.citations));
    if (method === 'state' || method === 'finish') return validatePiPublicTurn(value);
    if (method === 'admit') return piKeys(value, ['kind', 'turnToken']) && value.kind === 'admitted' && /^[a-f0-9]{64}$/u.test(value.turnToken)
      || piKeys(value, ['kind', 'turn']) && value.kind === 'existing' && validatePiPublicTurn(value.turn);
    if (method === 'status') return piKeys(value, ['canSend', 'nextCaseId']) && typeof value.canSend === 'boolean'
      && (value.canSend ? /^[a-z][a-z0-9-]{0,63}$/u.test(value.nextCaseId) : value.nextCaseId === null);
    return method === 'stop' && piKeys(value, ['stopping']) && value.stopping === true;
  };
  process.on('message', message => {
    void (async () => {
      if (message?.type === 'shutdown') {
        if (!piKeys(message, ['type', 'runId']) || message.runId !== runId) reject(); await close(); return;
      }
      if (message?.type === 'result') {
        if (!piKeys(message, ['type', 'runId', 'requestId', 'ok', 'value']) || message.runId !== runId || typeof message.ok !== 'boolean') reject();
        const request = pending.get(message.requestId); if (!request) reject(); pending.delete(message.requestId);
        if (!message.ok) { if (message.value !== null) reject(); request.reject(); return; }
        if (!validResult(request.method, message.value)) { request.reject(); reject(); } request.resolve(message.value); return;
      }
      if (starting || !piKeys(message, ['type', 'runId', 'sourceFiles', 'targetPaths', 'stateRoot', 'authorityRoot', 'budgetRoot', 'controlPath', 'controlDigest', 'loginPath', 'consumptionDigest'])
        || message.type !== 'init' || !UUID.test(message.runId)) reject();
      starting = true; runId = message.runId;
      let sequence = 0;
      const step = (stage, operation) => runPiStartupStep(stage, operation,
        row => new Promise((resolve, rejectReport) => {
          if (!process.connected) return rejectReport(new Error('owned channel closed'));
          process.send({ type: 'startup', runId, sequence: sequence++, ...row },
            error => error ? rejectReport(new Error('owned startup report failed')) : resolve());
        }));
      initialization = (async () => {
        const inputs = await step('source-load', () => loadPiNativeSources({ sourceFiles: message.sourceFiles, stateRoot: message.stateRoot, authorityRoot: message.authorityRoot }));
        if (closing) return;
        await step('preflight', () => preflightPiNative({ ...inputs, sourceFiles: message.sourceFiles, stateRoot: message.stateRoot,
          authorityRoot: message.authorityRoot, budgetRoot: message.budgetRoot, targetPaths: message.targetPaths }));
        if (closing) return;
        const plan = inputs.planAdmission.value;
        await step('authority-consumption', () => verifyNativeAuthorityConsumption({ authorityRoot: message.authorityRoot, plan, consumptionDigest: message.consumptionDigest }));
        if (closing) return;
        const { control, loginSecret } = await step('control-files', async () => {
          const allowedControl = [0, 1].slice(0, plan.restartAllowance + 1).map(i => `${basePath(message.stateRoot, plan, i)}.control.json`);
          if (!allowedControl.includes(message.controlPath) || message.loginPath !== message.controlPath.replace(/\.control\.json$/u, '.login.txt')) reject();
          const controlBytes = (await readPiPrivateFile(message.controlPath)).bytes;
          if (piHash(controlBytes) !== message.controlDigest) reject();
          const control = JSON.parse(controlBytes), loginSecret = (await readPiPrivateFile(message.loginPath, 256)).bytes.toString('utf8');
          if (!piKeys(control, ['schemaVersion', 'runId', 'activationPlanDigest', 'rootIdentity', 'chatPort', 'stopCapability'])
            || control.schemaVersion !== 'agentmo.pi-owned-control.v1' || control.runId !== runId || control.activationPlanDigest !== plan.installPlanDigest
            || control.chatPort !== plan.nativeBinding.chatPort || !isDeepStrictEqual(control.rootIdentity, plan.predecessor.rootIdentity)
            || !/^[a-f0-9]{64}$/u.test(control.stopCapability) || !/^[a-f0-9]{48}$/u.test(loginSecret)) reject();
          return { control, loginSecret };
        });
        if (closing) return;
        const { createPiSessionHost } = await import('./pi-session-host.js');
        const { startPiChatServer } = await import('./pi-chat-server.js');
        if (closing) return;
        const sdk = await step('sdk-import', async () => {
          const { loadPiSdk } = await import('./pi-sdk.js');
          return loadPiSdk({ descriptorAdmission: inputs.sourceAdmissions.targetDescriptor, targetPaths: message.targetPaths });
        });
        if (closing) return;
        const turnClient = { admit: input => call('admit', input), finish: input => call('finish', input),
          state: turnId => call('state', { turnId }), status: () => call('status', {}), workspace:sessionId=>call('workspace',{sessionId}), tool:input=>call('tool',input) };
        await step('session-prewarm', async () => {
          host = await createPiSessionHost({ stateRoot: message.stateRoot, binding: plan.nativeBinding, sdk, turnClient, approvedCases: plan.approvedCases });
        });
        if (closing) return;
        const port = plan.nativeBinding.chatPort, httpHost = `127.0.0.1:${port}`;
        await step('chat-listen', async () => {
          server = await startPiChatServer({ port, host: httpHost, origin: `http://${httpHost}`, sessionHost: host,
            loginSecret, stopCapability: control.stopCapability, onStop: () => call('stop', {}) });
        });
        if (closing) return;
        process.send({ type: 'ready', runId, agentId: plan.nativeBinding.agentId, chatPort: port });
      })();
      await initialization;
    })().catch(() => { void close(true); });
  });
  process.on('disconnect', () => { if (!closing) void close(true); });
  process.on('SIGINT', () => { void close(); }); process.on('SIGTERM', () => { void close(); });
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv[2] === '--pi-owned-child') {
  runOwnedPiChild().catch(() => { process.exitCode = 1; if (process.connected) process.disconnect(); });
}
