import assert from 'node:assert/strict';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { readdir, lstat, realpath } from 'node:fs/promises';
import { readPiCliText } from './pi-chat-cli.js';
import { piIdentity, piHash, readPiPrivateFile } from './pi-install-plan.js';
import { validatePiWorkspace } from './pi-workspace-policy.js';
import { assertNativeChatAbsentRoot, publishNativeChatFiles, writeNativeChatFile } from './native-chat-files.js';

const snapshots = new WeakSet();
const outputs = new WeakSet(), stagedValues = new WeakMap();
const fail = () => { throw Object.assign(new Error('Workspace operation rejected.'), { code: 'AGENTMO_PI_WORKSPACE_REJECTED' }); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const freeze = v => { if (v && typeof v === 'object') { for (const x of Object.values(v)) freeze(x); Object.freeze(v); } return v; };
const sourceName = s => typeof s === 'string' && /^[^./][^/\\]*\.(txt|md)$/iu.test(s)
  && !/(?:^|[._-])(?:auth|credentials?|secrets?|tokens?|passwords?|passwd|api[-_]?keys?|keys?|private[-_]?key|login|control)(?:[._-]|$)/iu.test(s);

export async function listWorkspaceSources({ sourceRoot }) {
  if (!path.isAbsolute(sourceRoot) || path.normalize(sourceRoot) !== sourceRoot
    || sourceRoot.split(path.sep).some(p => /^\.env/iu.test(p) || ['.agentmo','.superpowers','.git','.ssh','.aws','.codex','.agents','node_modules','sessions','turns','attempts'].includes(p.toLowerCase()))
    || await realpath(sourceRoot) !== sourceRoot) fail();
  const result = [];
  for (const name of (await readdir(sourceRoot)).sort()) {
    if (!sourceName(name)) continue;
    const s = await lstat(path.join(sourceRoot, name));
    if (s.isFile() && !s.isSymbolicLink() && s.nlink === 1 && s.uid === process.getuid() && s.size <= 4096) result.push(name);
    if (result.length === 2) break;
  }
  return result;
}
export async function captureWorkspace({ sourceRoot, relativePaths, skill }) {
  if (!Array.isArray(relativePaths) || relativePaths.length < 1 || relativePaths.length > 2
    || new Set(relativePaths).size !== relativePaths.length || typeof skill?.body !== 'string'
    || Buffer.byteLength(skill.body) > 4096 || piHash(skill.body) !== skill.digest) fail();
  const sources = [];
  for (const [index, relativePath] of relativePaths.entries()) {
    const f = await readPiCliText({ sourceRoot, relativePath });
    if (Buffer.byteLength(f.text) > 4096) fail();
    sources.push({ sourceId: `source-${index+1}`, logicalPath: `sources/${index+1}.md`,
      originalPath: path.join(sourceRoot, relativePath), relativePath, identity: f.identity,
      contentDigest: f.contentDigest, text: f.text, lineCount: f.text.split('\n').length });
  }
  if (sources.reduce((n,s)=>n+Buffer.byteLength(s.text),0) > 8192) fail();
  const snapshotDigest = piHash(JSON.stringify({ sources: sources.map(({sourceId,logicalPath,contentDigest})=>({sourceId,logicalPath,contentDigest})), skillDigest: skill.digest }));
  const value = freeze({ sourceRoot, sources, skill: structuredClone(skill), snapshotDigest });
  snapshots.add(value); return value;
}
export async function revalidateWorkspace({ snapshot }) {
  if (!snapshots.has(snapshot)) fail();
  for (const s of snapshot.sources) {
    const f = await readPiCliText({ sourceRoot: snapshot.sourceRoot, relativePath: s.relativePath });
    if (!isDeepStrictEqual(f.identity,s.identity) || f.contentDigest !== s.contentDigest) fail();
  }
}
export function createWorkspaceTools({ binding, snapshot, admittedHistoryRecords = [], attemptRoot, signal }) {
  if (!snapshots.has(snapshot) || !validatePiWorkspace(binding.policy).ok || binding.snapshotDigest !== snapshot.snapshotDigest
    || !isDeepStrictEqual(binding.policy.skill,snapshot.skill) || !path.isAbsolute(attemptRoot)) fail();
  let closed = false, busy = false, count = 0, staged = null;
  const records = [], ids = new Set(), readIds = new Set();
  // These records are supplied only by the parent after native-history admission.
  for (const r of admittedHistoryRecords) {
    if (r.sessionId !== binding.sessionId || r.snapshotDigest !== binding.snapshotDigest || r.skillDigest !== snapshot.skill.digest
      || r.taskStatus !== 'passed' || r.name !== 'read') fail();
    const source = snapshot.sources.find(s=>s.logicalPath===r.args.path);
    if (source && r.result.contentDigest === source.contentDigest && r.result.text === source.text) readIds.add(source.sourceId);
  }
  const check = () => { if (closed || signal?.aborted) fail(); };
  const close = () => { closed = true; };
  return {
    close,
    get records() { return structuredClone(records); },
    get count() { return count; },
    get staged() { if (!staged) return null; const value = { ...staged, bytes: Buffer.from(staged.bytes), citations: structuredClone(staged.citations) }; stagedValues.set(value,{taskId:binding.taskId,sessionId:binding.sessionId,snapshotDigest:binding.snapshotDigest}); return value; },
    async execute(input) {
      try {
        check(); if (busy) fail(); busy = true;
        if (!exact(input,['taskId','sessionId','toolCallId','name','args']) || input.taskId !== binding.taskId || input.sessionId !== binding.sessionId
          || typeof input.toolCallId !== 'string' || !input.toolCallId || input.toolCallId.length > 128 || ids.has(input.toolCallId) || ++count > 8) fail();
        ids.add(input.toolCallId); const {name,args} = input; let result;
        if (name === 'read') {
          if (!exact(args,['path'])) fail();
          const source = snapshot.sources.find(s=>s.logicalPath===args.path);
          if (source) { readIds.add(source.sourceId); result = { sourceId: source.sourceId, contentDigest: source.contentDigest, startLine: 1, endLine: source.lineCount, text: source.text }; }
          else if (args.path === `skills/${snapshot.skill.name}/SKILL.md`) result = { sourceId: 'skill', contentDigest: snapshot.skill.digest, startLine: 1, endLine: snapshot.skill.body.split('\n').length, text: snapshot.skill.body };
          else fail();
        } else if (name === 'write') {
          if (!exact(args,['path','content']) || args.path !== 'output/report.md' || staged
            || typeof args.content !== 'string' || !args.content.trim() || !args.content.isWellFormed() || Buffer.byteLength(args.content) > 8192) fail();
          const references = new Map();
          const content = args.content.replace(/\[(?:source-|skill:L)[^\]\r\n]*\]?/giu, marker => {
            const match = /^\[(source-[1-9]\d*):L([1-9]\d*)(?:-L([1-9]\d*))?\]$/u.exec(marker);
            if (!match) fail();
            const [, sourceId, start, end = start] = match;
            const source = snapshot.sources.find(s => s.sourceId === sourceId);
            const startLine = Number(start), endLine = Number(end);
            if (!source || !readIds.has(sourceId) || !Number.isSafeInteger(startLine) || !Number.isSafeInteger(endLine)
              || endLine < startLine || endLine > source.lineCount) fail();
            const normalized = `[${sourceId}:L${startLine}-L${endLine}]`;
            references.set(normalized, { sourceId, startLine, endLine });
            return normalized;
          });
          if (!references.size || references.size > 128 || Buffer.byteLength(content) > 8192) fail();
          const citations = [...references.values()];
          const bytes = Buffer.from(content), contentDigest = piHash(bytes); check();
          await writeNativeChatFile({filePath:path.join(attemptRoot,'report.staged.md'),bytes}); check();
          staged = { bytes, contentDigest, byteLength:bytes.length, citations };
          result = {status:'staged',contentDigest,byteLength:bytes.length,citations:structuredClone(citations)};
        } else fail();
        check(); records.push({ ...structuredClone(input), snapshotDigest:binding.snapshotDigest, skillDigest:snapshot.skill.digest, result:structuredClone(result) });
        return result;
      } catch { close(); fail(); } finally { busy = false; }
    },
  };
}

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const overlaps = (a,b) => a === b || a.startsWith(b+path.sep) || b.startsWith(a+path.sep);
const digest = value => typeof value==='string' && /^sha256:[a-f0-9]{64}$/u.test(value);
const outputLocation = value => typeof value==='string' && path.isAbsolute(value) && path.resolve(value)===value && !value.includes('\0')
  && !value.split(path.sep).some(p=>/(?:^|[._-])(?:auth|credentials?|secrets?|tokens?|passwords?|passwd|api[-_]?keys?|private[-_]?key|login|control)(?:[._-]|$)/iu.test(p)
    || /^\.env/iu.test(p) || ['.git','.agentmo','.superpowers','.codex','.agents','.aws','.ssh','node_modules','sessions','turns','attempts'].includes(p.toLowerCase()));
async function privateDirectoryIdentity(directory) {
  if(typeof directory!=='string' || !path.isAbsolute(directory) || path.resolve(directory)!==directory || directory.includes('\0'))fail();
  const s=await lstat(directory,{bigint:true});
  if(await realpath(directory)!==directory || !s.isDirectory() || s.isSymbolicLink() || s.uid!==BigInt(process.getuid()) || (s.mode&0o777n)!==0o700n)fail();
  return piIdentity(s);
}
export async function captureWorkspaceOutput({ outputRoot, taskId, excludedRoots }) {
  if (!outputLocation(outputRoot) || !UUID.test(taskId) || !Array.isArray(excludedRoots) || !excludedRoots.length
    || excludedRoots.some(p=>typeof p!=='string' || !path.isAbsolute(p) || overlaps(outputRoot,path.resolve(p))))fail();
  const s=await lstat(outputRoot,{bigint:true});
  if(await realpath(outputRoot)!==outputRoot || !s.isDirectory() || s.isSymbolicLink() || s.uid!==BigInt(process.getuid()) || (s.mode&0o777n)!==0o700n) fail();
  const directory=path.join(outputRoot,taskId);await assertNativeChatAbsentRoot(directory);
  const value=freeze({outputRoot,taskId,directory,identity:piIdentity(s)});outputs.add(value);return value;
}
export async function revalidateWorkspaceOutput(output) {
  if(!outputs.has(output))fail();
  const s=await lstat(output.outputRoot,{bigint:true});
  if(await realpath(output.outputRoot)!==output.outputRoot || !isDeepStrictEqual(piIdentity(s),output.identity)
    || !s.isDirectory() || s.isSymbolicLink() || s.uid!==BigInt(process.getuid()) || (s.mode&0o777n)!==0o700n)fail();
  await assertNativeChatAbsentRoot(output.directory);
}
export async function publishWorkspaceArtifact({ binding, staged, finalReply, sessionDurable, taskState, signal }) {
  const output=binding.output;
  if(!outputs.has(output) || output.taskId!==binding.taskId || !stagedValues.has(staged) || signal?.aborted
    || !isDeepStrictEqual(stagedValues.get(staged),{taskId:binding.taskId,sessionId:binding.sessionId,snapshotDigest:binding.snapshotDigest})
    || !UUID.test(binding.sessionId) || !validatePiWorkspace(binding.policy).ok
    || !/^sha256:[a-f0-9]{64}$/u.test(binding.agentDigest) || !/^sha256:[a-f0-9]{64}$/u.test(binding.snapshotDigest)
    || typeof finalReply!=='string' || !finalReply.trim() || sessionDurable!==true || taskState.status!=='completed'
    || taskState.activeRequests!==0 || taskState.toolsBusy!==false || taskState.skillInContext!==true
    || !Number.isInteger(taskState.requests) || taskState.requests<1 || taskState.requests>6
    || !Number.isInteger(taskState.tools) || taskState.tools<1 || taskState.tools>8
    || taskState.reservations!==taskState.requests || !Number.isFinite(binding.deadline) || Date.now()>=binding.deadline
    || !Buffer.isBuffer(staged.bytes) || staged.bytes.length!==staged.byteLength || piHash(staged.bytes)!==staged.contentDigest)fail();
  await revalidateWorkspaceOutput(output);if(signal?.aborted)fail();
  const manifest={schemaVersion:'agentmo.pi-workspace-artifact.v1',taskId:binding.taskId,sessionId:binding.sessionId,
    agentDigest:binding.agentDigest,skillDigest:binding.policy.skill.digest,snapshotDigest:binding.snapshotDigest,
    fileName:'report.md',byteLength:staged.byteLength,contentDigest:staged.contentDigest,citations:staged.citations,
    requests:taskState.requests,tools:taskState.tools,reservations:taskState.reservations,publication:'published',cleanup:'pending'};
  // Persist only the private task/output identity needed by a new process; never source or report text.
  const publicationBinding={schemaVersion:'agentmo.pi-workspace-publication-binding.v1',taskId:binding.taskId,sessionId:binding.sessionId,
    agentDigest:binding.agentDigest,skillDigest:binding.policy.skill.digest,snapshotDigest:binding.snapshotDigest,
    attemptIdentity:await privateDirectoryIdentity(binding.attemptRoot),outputRoot:output.outputRoot,outputRootIdentity:output.identity};
  await writeNativeChatFile({filePath:path.join(binding.attemptRoot,'publication-binding.json'),bytes:Buffer.from(JSON.stringify(publicationBinding))});
  // A durable claim precedes the first output mutation. Any later error is uncertain; never retry or remove the scene.
  await writeNativeChatFile({filePath:path.join(binding.attemptRoot,'publication.claim.json'),bytes:Buffer.from(JSON.stringify({taskId:binding.taskId,
    contentDigest:staged.contentDigest,bindingDigest:piHash(JSON.stringify(publicationBinding)),manifestDigest:piHash(JSON.stringify(manifest))}))});
  try {
    if(signal?.aborted)throw new Error('cancelled');
    await publishNativeChatFiles({root:output.directory,files:[{relativePath:'report.md',bytes:staged.bytes,mode:0o600}]});
    const report=await readPiPrivateFile(path.join(output.directory,'report.md'),8192);
    if(piHash(report.bytes)!==staged.contentDigest)throw new Error('changed output');
    await writeNativeChatFile({filePath:path.join(binding.attemptRoot,'publication-output.json'),bytes:Buffer.from(JSON.stringify({taskId:binding.taskId,
      directoryIdentity:await privateDirectoryIdentity(output.directory),fileIdentity:report.identity}))});
    if(signal?.aborted || Date.now()>=binding.deadline)throw new Error('cancelled');
    await writeNativeChatFile({filePath:path.join(binding.attemptRoot,'artifact.json'),bytes:Buffer.from(JSON.stringify(manifest))});
    return manifest;
  } catch { throw Object.assign(new Error('Workspace publication could not be confirmed.'),{code:'publication-uncertain',directory:output.directory,contentDigest:staged.contentDigest}); }
}
export async function finishWorkspaceArtifact({ binding, manifest, cleanup }) {
  if(manifest.taskId!==binding.taskId || manifest.publication!=='published' || manifest.cleanup!=='pending')fail();
  const result={...manifest,cleanup:cleanup==='stopped'?'stopped':'failed',status:cleanup==='stopped'?'passed':'failed-cleanup'};
  await writeNativeChatFile({filePath:path.join(binding.attemptRoot,'result.json'),bytes:Buffer.from(JSON.stringify(result))});
  return result;
}

export async function recoverWorkspaceArtifact({ attemptRoot }) {
  if(typeof attemptRoot!=='string' || path.basename(path.dirname(attemptRoot))!=='attempts')fail();
  const taskId=path.basename(attemptRoot).replace(/^pi-workspace-/u,'');if(!UUID.test(taskId))fail();
  const attemptIdentity=await privateDirectoryIdentity(attemptRoot);
  const read=async name=>{try{return JSON.parse((await readPiPrivateFile(path.join(attemptRoot,name),32768)).bytes);}catch(e){if(e.code==='ENOENT')return null;throw e;}};
  let uncertain={status:'publication-uncertain',taskId};
  try {
    const claim=await read('publication.claim.json'),binding=await read('publication-binding.json');
    if(!claim && !binding)return {status:'not-published',taskId};
    if(!exact(claim,['taskId','contentDigest','bindingDigest','manifestDigest']) || claim.taskId!==taskId
      || ![claim.contentDigest,claim.bindingDigest,claim.manifestDigest].every(digest))return uncertain;
    uncertain={...uncertain,contentDigest:claim.contentDigest};
    if(!exact(binding,['schemaVersion','taskId','sessionId','agentDigest','skillDigest','snapshotDigest','attemptIdentity','outputRoot','outputRootIdentity'])
      || binding.schemaVersion!=='agentmo.pi-workspace-publication-binding.v1' || binding.taskId!==taskId || !UUID.test(binding.sessionId)
      || ![binding.agentDigest,binding.skillDigest,binding.snapshotDigest].every(digest)
      || piHash(JSON.stringify(binding))!==claim.bindingDigest || !isDeepStrictEqual(binding.attemptIdentity,attemptIdentity)
      || !outputLocation(binding.outputRoot) || overlaps(binding.outputRoot,attemptRoot)
      || !isDeepStrictEqual(await privateDirectoryIdentity(binding.outputRoot),binding.outputRootIdentity))return uncertain;
    const directory=path.join(binding.outputRoot,taskId),observed=await read('publication-output.json');
    if(!exact(observed,['taskId','directoryIdentity','fileIdentity']) || observed.taskId!==taskId
      || !isDeepStrictEqual(await privateDirectoryIdentity(directory),observed.directoryIdentity))return uncertain;
    const manifest=await read('artifact.json'),result=await read('result.json');
    const keys=['schemaVersion','taskId','sessionId','agentDigest','skillDigest','snapshotDigest','fileName','byteLength','contentDigest','citations','requests','tools','reservations','publication','cleanup'];
    if(!exact(manifest,keys) || !exact(result,[...keys,'status']) || manifest.schemaVersion!=='agentmo.pi-workspace-artifact.v1'
      || manifest.taskId!==taskId || manifest.sessionId!==binding.sessionId || manifest.agentDigest!==binding.agentDigest
      || manifest.skillDigest!==binding.skillDigest || manifest.snapshotDigest!==binding.snapshotDigest
      || manifest.contentDigest!==claim.contentDigest || piHash(JSON.stringify(manifest))!==claim.manifestDigest
      || manifest.fileName!=='report.md' || manifest.publication!=='published' || manifest.cleanup!=='pending'
      || !isDeepStrictEqual({...result,cleanup:manifest.cleanup,status:undefined},{...manifest,status:undefined})
      || !['passed','failed-cleanup'].includes(result.status)
      || (result.status==='passed'?result.cleanup!=='stopped':result.cleanup!=='failed'))return uncertain;
    const file=path.join(directory,'report.md');
    if(!isDeepStrictEqual(piIdentity(await lstat(file,{bigint:true})),observed.fileIdentity))return uncertain;
    const report=await readPiPrivateFile(file,8192);
    if(!isDeepStrictEqual(report.identity,observed.fileIdentity) || piHash(report.bytes)!==claim.contentDigest || report.bytes.length!==manifest.byteLength)return uncertain;
    return result;
  } catch {return uncertain;}
}

export function workspaceTaskCase({ binding, workspace }) {
  const {snapshot,output,taskId,sessionId,deadline,approvedText,attemptRoot}=workspace;
  if(!snapshots.has(snapshot) || !outputs.has(output) || !/^sha256:[a-f0-9]{64}$/u.test(workspace.historyDigest) || output.taskId!==taskId || !UUID.test(sessionId)
    || !Number.isFinite(deadline) || typeof approvedText!=='string' || !approvedText.trim() || !approvedText.isWellFormed()
    || [...approvedText].length>8000 || !isDeepStrictEqual(snapshot.skill,binding.pi_workspace?.skill))fail();
  const digest=piHash(JSON.stringify({nativeBinding:binding,taskId,sessionId,deadline,output,attemptRoot,
    historyDigest:workspace.historyDigest,snapshotDigest:snapshot.snapshotDigest,sourceRoot:snapshot.sourceRoot,
    sources:snapshot.sources.map(({originalPath,identity,contentDigest})=>({originalPath,identity,contentDigest})),taskDigest:piHash(approvedText)}));
  return {caseId:`workspace-${BigInt('0x'+digest.slice(7)).toString(36)}`,sessionId,inputDigest:piHash(approvedText)};
}
