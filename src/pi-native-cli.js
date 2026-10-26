import path from 'node:path';
import { subjectsForCommand } from './artifact-subjects.js';
import { loadAdmittedArtifact } from './artifact-admission.js';
import { buildPiTargetDescriptor, isPiNodeSupported } from './pi-target-descriptor.js';
import { buildPiTargetCarrierAdmission, writePiTargetCarrierAdmission } from './pi-target-admission.js';
import { admitPiPackageArchive, buildPiInstallPlan, piBytes, piHash, piKeys, readPiPrivateFile } from './pi-install-plan.js';
import { applyPiInstall, admitPiInstallReceipt } from './pi-install.js';
import { buildPiInstallApproval, buildPiSensitiveActionDecision, buildPiConflictApproval } from './pi-install-approval.js';
import { validateNativeAuthorityBinding } from './native-chat-authority.js';
import { writeNativeChatFile } from './native-chat-files.js';
import { courseBudgetReference } from './course-wiki-budget.js';
import { loadPiNativeSources, startPiNative, stopPiNative } from './pi-native-runtime.js';

const defs = {
  blueprint: ['blueprint', 'blueprint'], buildContract: ['build-contract', 'build-contract'], planApproval: ['plan-approval', 'plan-approval'],
  targetDescriptor: ['target-descriptor', 'pi-target-descriptor'], targetCarrierAdmission: ['target-carrier-admission', 'pi-target-carrier-admission'],
  archive: ['archive', 'package-archive'], installPlan: ['installed-plan', 'pi-installed-plan'], installReceipt: ['install-receipt', 'pi-install-receipt'],
  activationPlan: ['install-plan', 'pi-install-plan'],
};
const baseSources = ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor', 'targetCarrierAdmission', 'archive'];
const targetFlags = ['sdk-root', 'node-executable', 'lock-file'];
const reject = () => { throw Object.assign(new Error('Pi command requires exact sources and approvals; SDK commands require Node >=22.19.0.'), { code: 'AGENTMO_PI_NATIVE_CLI_REJECTED' }); };

function parse(command, args) {
  const options = {}, digests = {}, sensitive = [];
  for (let i = 0; i < args.length; i++) {
    const flag = args[i]; if (!flag.startsWith('--')) reject();
    const name = flag.slice(2);
    if (name === 'digest') {
      const match = /^([a-z][a-z0-9-]*)=(sha256:[a-f0-9]{64})$/u.exec(args[++i] ?? '');
      if (!match || Object.hasOwn(digests, match[1])) reject(); digests[match[1]] = match[2]; continue;
    }
    if (name === 'sensitive-decision') { const value = args[++i]; if (!value || value.startsWith('--') || sensitive.length === 3) reject(); sensitive.push(value); continue; }
    if (Object.hasOwn(options, name)) reject();
    if (['json', 'approve', 'apply'].includes(name)) options[name] = true;
    else { const value = args[++i]; if (!value || value.startsWith('--')) reject(); options[name] = value; }
  }
  let fields = [], flags = ['json'], subjects = [];
  if (command === 'pi-target-describe') flags.push(...targetFlags, 'out');
  else if (command === 'pi-target-admit') { fields = ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor']; flags.push(...targetFlags, 'out'); }
  else if (command === 'pi-install-preview') {
    if (!['install', 'activate'].includes(options.lifecycle)) reject(); fields = [...baseSources, ...(options.lifecycle === 'activate' ? ['installPlan', 'installReceipt'] : [])];
    flags.push('lifecycle', 'target-root', 'authority-root', 'authority-binding', 'budget-root', 'chat-port', 'proxy-port', 'out'); subjects.push('native-authority-binding');
    if (options.lifecycle === 'activate') { flags.push('cases', 'restart-allowance', 'activation-id'); if (options.cases) subjects.push('pi-approved-cases'); }
  } else if (command === 'pi-install-approve') {
    flags.push('install-plan', 'family', 'issued-at', 'expires-at', 'nonce', 'approve', 'out'); subjects.push('pi-install-plan');
    if (options.family === 'sensitive') flags.push('action-id'); else if (!['ordinary', 'conflicts'].includes(options.family)) reject();
  } else if (command === 'pi-install-apply') {
    fields = [...baseSources, 'activationPlan']; flags.push('target-root', 'authority-root', 'ordinary-approval', 'conflict-approval', 'apply'); subjects.push('pi-install-approval', 'pi-conflict-approval');
  } else if (command === 'pi-native-serve') {
    fields = Object.keys(defs); flags.push(...targetFlags, 'target-root', 'authority-root', 'budget-root', 'runtime-env-file', 'ordinary-approval', 'conflict-approval');
    subjects.push('pi-install-approval', 'pi-conflict-approval', ...sensitive.map((_, i) => `pi-sensitive-action-decision-${i + 1}`));
    if (![2, 3].includes(sensitive.length)) reject();
  } else if (command === 'pi-native-stop') { fields = ['activationPlan']; flags.push('target-root'); }
  else reject();
  if (command !== 'pi-native-serve' && sensitive.length) reject();
  flags.push(...fields.map(k => defs[k][0])); subjects.push(...fields.map(k => defs[k][1]));
  if (Object.keys(options).some(k => !flags.includes(k)) || !isDeepSet(Object.keys(digests), subjects)) reject();
  if (!isDeepSet(subjects, subjectsForCommand(command, { lifecycle: options.lifecycle,
    sensitiveDecisionCount: sensitive.length || 2, includeOptionalSubjects: options.cases ? ["pi-approved-cases"] : [] }))) reject();
  const required = flags.filter(k => !['json', 'runtime-env-file', 'cases', 'restart-allowance'].includes(k));
  if (required.some(k => options[k] === undefined)) reject();
  const sourceFiles = Object.fromEntries(fields.map(k => [k, { filePath: absolute(options[defs[k][0]]), expectedDigest: digests[defs[k][1]] }]));
  return { options, digests, sourceFiles, sensitive };
}
const isDeepSet = (a, b) => new Set(b).size === b.length && a.length === b.length && b.every(k => a.includes(k));
function absolute(value) { if (typeof value !== 'string' || !path.isAbsolute(value) || path.resolve(value) !== value || value.includes('\0')) reject(); return value; }
async function readJson(filePath, expectedDigest) {
  if (path.basename(filePath).startsWith('.env')) reject();
  const bytes = (await readPiPrivateFile(absolute(filePath))).bytes;
  if (piHash(bytes) !== expectedDigest) reject(); return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
async function planningSources(sourceFiles) {
  const a = {};
  for (const k of ['blueprint', 'buildContract', 'planApproval', 'targetDescriptor']) a[k] = await loadAdmittedArtifact({ ...sourceFiles[k], subject: defs[k][1] });
  if (sourceFiles.targetCarrierAdmission) a.targetCarrierAdmission = await loadAdmittedArtifact({ ...sourceFiles.targetCarrierAdmission,
    subject: 'pi-target-carrier-admission', companions: { blueprint: a.blueprint, 'build-contract': a.buildContract, 'plan-approval': a.planApproval, 'pi-target-descriptor': a.targetDescriptor } });
  if (sourceFiles.archive) a.archive = await admitPiPackageArchive(sourceFiles.archive);
  return a;
}
async function decisions(planAdmission, parsed) {
  const { options: o, digests, sensitive } = parsed;
  const one = async (filePath, subject, digest) => (await loadAdmittedArtifact({ filePath: absolute(filePath), expectedDigest: digest,
    subject, companions: { 'pi-install-plan': planAdmission } })).value;
  return { ordinaryApproval: await one(o['ordinary-approval'], 'pi-install-approval', digests['pi-install-approval']),
    conflictApproval: await one(o['conflict-approval'], 'pi-conflict-approval', digests['pi-conflict-approval']),
    sensitiveDecisions: await Promise.all(sensitive.map((filePath, i) => one(filePath, 'pi-sensitive-action-decision', digests[`pi-sensitive-action-decision-${i + 1}`]))) };
}

export async function runPiNativeCommand(command, args) {
  let run, signalController;
  const stop = () => signalController?.abort();
  try {
    const parsed = parse(command, args), { options: o, digests, sourceFiles } = parsed;
    if (!isPiNodeSupported(process.versions.node) && !['pi-native-stop', 'pi-install-approve'].includes(command)) reject();
    const targetPaths = () => ({ sdkRoot: absolute(o['sdk-root']), nodeExecutablePath: absolute(o['node-executable']), lockFilePath: absolute(o['lock-file']) });
    const output = async (artifact, subject) => {
      if (o.out) await writeNativeChatFile({ filePath: absolute(o.out), bytes: piBytes(artifact) });
      return { artifact, subject, json: o.json === true };
    };
    if (command === 'pi-target-describe') return output(await buildPiTargetDescriptor(targetPaths()), 'pi-target-descriptor');
    if (command === 'pi-target-admit') {
      const artifact = await buildPiTargetCarrierAdmission({ admissions: await planningSources(sourceFiles), targetPaths: targetPaths() });
      await writePiTargetCarrierAdmission(absolute(o.out), artifact); return { artifact, subject: 'pi-target-carrier-admission', json: o.json === true };
    }
    if (command === 'pi-install-preview') {
      const admissions = await planningSources(sourceFiles), stateRoot = absolute(o['target-root']), authorityRoot = absolute(o['authority-root']);
      let predecessor = null;
      if (o.lifecycle === 'activate') {
        const plan = await loadAdmittedArtifact({ ...sourceFiles.installPlan, subject: 'pi-install-plan' });
        predecessor = await admitPiInstallReceipt({ ...sourceFiles.installReceipt, admissions: { ...admissions, plan }, stateRoot, authorityRoot });
      }
      const authorityRootBinding = await readJson(o['authority-binding'], digests['native-authority-binding']);
      if (!validateNativeAuthorityBinding(authorityRootBinding) || authorityRootBinding.rootDigest !== piHash(authorityRoot)) reject();
      return output(buildPiInstallPlan({ lifecycle: o.lifecycle, admissions, stateRoot, authorityRootBinding,
        budgetReference: await courseBudgetReference({ root: absolute(o['budget-root']) }), ports: { chat: Number(o['chat-port']), proxy: Number(o['proxy-port']) }, predecessor,
        ...(o.lifecycle === 'activate' ? { activationId: o['activation-id'], approvedCases: o.cases ? await readJson(o.cases, digests['pi-approved-cases']) : [], restartAllowance: Number(o['restart-allowance'] ?? 0) } : {}) }), 'pi-install-plan');
    }
    if (command === 'pi-install-approve') {
      if (!o.approve) reject();
      const plan = (await loadAdmittedArtifact({ filePath: absolute(o['install-plan']), subject: 'pi-install-plan', expectedDigest: digests['pi-install-plan'] })).value;
      const common = { plan, decision: 'approve', issuedAt: o['issued-at'], expiresAt: o['expires-at'], useNonce: o.nonce };
      if (o.family === 'ordinary') return output(buildPiInstallApproval(common), 'pi-install-approval');
      if (o.family === 'conflicts') return output(buildPiConflictApproval({ ...common, conflicts: [] }), 'pi-conflict-approval');
      const action = plan.sensitiveActions.find(a => a.id === o['action-id']); if (!action) reject();
      return output(buildPiSensitiveActionDecision({ ...common, action }), 'pi-sensitive-action-decision');
    }
    if (command === 'pi-install-apply') {
      if (!o.apply) reject();
      const planAdmission = await loadAdmittedArtifact({ ...sourceFiles.activationPlan, subject: 'pi-install-plan' });
      if (planAdmission.value.lifecycle !== 'install') reject();
      const artifact = await applyPiInstall({ planAdmission, sourceAdmissions: await planningSources(sourceFiles),
        ...await decisions(planAdmission, parsed), stateRoot: absolute(o['target-root']), authorityRoot: absolute(o['authority-root']) });
      if (artifact.status !== 'complete') process.exitCode = 1;
      return { artifact, subject: artifact.status === 'complete' ? 'pi-install-receipt' : 'pi-install-incomplete', json: o.json === true };
    }
    if (command === 'pi-native-stop') {
      const planAdmission = await loadAdmittedArtifact({ ...sourceFiles.activationPlan, subject: 'pi-install-plan' });
      return { artifact: await stopPiNative({ planAdmission, stateRoot: absolute(o['target-root']) }), subject: 'pi-owned-stop', json: o.json === true };
    }
    const stateRoot = absolute(o['target-root']), authorityRoot = absolute(o['authority-root']);
    const inputs = await loadPiNativeSources({ sourceFiles, stateRoot, authorityRoot });
    signalController = new AbortController(); process.on('SIGINT', stop); process.on('SIGTERM', stop);
    run = await startPiNative({ ...inputs, sourceFiles, ...await decisions(inputs.planAdmission, parsed), stateRoot, authorityRoot,
      targetPaths: targetPaths(), budgetRoot: absolute(o['budget-root']), approvedCases: inputs.planAdmission.value.approvedCases,
      ...(o['runtime-env-file'] ? { runtimeEnvFile: absolute(o['runtime-env-file']) } : {}), signal: signalController.signal });
    // Operational UI output names the private access file; it never includes the access value.
    process.stdout.write(`${JSON.stringify(run.entry)}\n`);
    if ((await run.completion).status !== 'stopped') reject();
    return null;
  } catch { reject(); }
  finally { process.off('SIGINT', stop); process.off('SIGTERM', stop); await run?.stop(); }
}

export async function runPiDeliveryCommand(args) {
  const sourceNames={...defs,activationPlan:['install-plan','pi-install-plan']};
  const o={},required=['execution-profile','target-root','authority-root',...Object.values(sourceNames).flatMap(([flag])=>[flag,`${flag}-sha256`])];
  const optional=['acceptance','acceptance-sha256','case-plans','case-plans-sha256'];
  for(let i=0;i<args.length;i++) {
    const flag=args[i];if(!flag.startsWith('--')||Object.hasOwn(o,flag.slice(2)))reject();const k=flag.slice(2);
    if(k==='json'){o[k]=true;continue;}if(![...required,...optional].includes(k)||!args[i+1]||args[i+1].startsWith('--'))reject();o[k]=args[++i];
  }
  if(required.some(k=>!o[k])||o['execution-profile']!=='native-chat'||optional.some(k=>Boolean(o[k])!==Boolean(o.acceptance)))reject();
  const sourceFiles=Object.fromEntries(Object.entries(sourceNames).map(([k,[flag]])=>[k,{filePath:absolute(o[flag]),expectedDigest:o[`${flag}-sha256`]}]));
  const stateRoot=absolute(o['target-root']),authorityRoot=absolute(o['authority-root']);
  const loaded=await loadPiNativeSources({sourceFiles,stateRoot,authorityRoot}),s=loaded.sourceAdmissions;
  const admissions={blueprint:s.blueprint,packageManifest:s.archive.manifest,activationPlan:loaded.planAdmission,installReceipt:s.installReceipt,acceptance:null};
  if(admissions.blueprint.value.native_runtime!=='pi')reject();
  if(o.acceptance) {
    const files=await readJson(o['case-plans'],o['case-plans-sha256']),casePlans={};
    if(!files||typeof files!=='object'||Array.isArray(files)||Object.keys(files).length>19)reject();
    for(const [k,b] of Object.entries(files)) {if(!piKeys(b,['filePath','expectedDigest']))reject();casePlans[k]=await loadAdmittedArtifact({...b,filePath:absolute(b.filePath),subject:'pi-install-plan'});}
    const {admitPiChatAcceptance}=await import('./pi-chat-acceptance.js');
    admissions.acceptance=await admitPiChatAcceptance({filePath:absolute(o.acceptance),expectedDigest:o['acceptance-sha256'],admissions:{...admissions,casePlans},authorityRoot,stateRoot});
  }
  const {buildDeliveryReport}=await import('./delivery-report.js');
  const report=await buildDeliveryReport(admissions.blueprint.value,{nativeChat:Object.fromEntries(['packageManifest','activationPlan','installReceipt','acceptance'].map(k=>[k,admissions[k]?.value??null])),admissions});
  return {report,json:o.json===true};
}
