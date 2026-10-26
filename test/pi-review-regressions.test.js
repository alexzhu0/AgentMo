import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {EventEmitter} from 'node:events';
import {randomUUID} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
const local=relative=>import(pathToFileURL(path.resolve(relative)).href);
const {piKeys,piHash}=await local('src/pi-install-plan.js');
const {runPiStartupStep}=await local('src/pi-native-runtime.js');
const tick=()=>new Promise(resolve=>setImmediate(resolve));

test('owned child drains startup resources before disconnecting after shutdown',async()=>{
 const source=await readFile('src/pi-native-runtime.js','utf8');
 const start=source.indexOf('async function runOwnedPiChild()'),end=source.indexOf('\nif (process.argv[1]',start);assert.ok(start>=0&&end>start);
 let body=source.slice(start,end);
 for(const [file,key] of [['pi-sdk.js','sdk'],['pi-session-host.js','host'],['pi-chat-server.js','server']]){const expr=`await import('./${file}')`;assert.equal(body.split(expr).length,2);body=body.replace(expr,`deps.${key}`);}
 for(const phase of ['sdk','host','server','host-report','server-report']){
  const failReport=phase.endsWith('-report'),failedStage=phase==='host-report'?'session-prewarm':'chat-listen';
  const fake=new EventEmitter(),trace=[];Object.assign(fake,{env:{AGENTMO_PI_CHILD:'1'},connected:true,umask:()=>{},exitCode:0,
   send(m,done){trace.push(m.type);done?.(failReport&&m.type==='startup'&&m.stage===failedStage&&m.state==='passed'?new Error('synthetic report failure'):undefined);},
   disconnect(){trace.push('disconnect');this.connected=false;this.emit('disconnect');}});
  let release,reached;const gate=new Promise(resolve=>{release=resolve;}),waiting=new Promise(resolve=>{reached=resolve;});
  const pause=async stage=>{if(stage===phase){reached();await gate;}};
  const runId=randomUUID(),stateRoot='/private/tmp/pi-synthetic-child',plan={restartAllowance:0,installPlanDigest:piHash('plan'),nativeBinding:{chatPort:19492,agentId:'meeting-text'},predecessor:{rootIdentity:{device:'1',inode:'2',birthtimeNs:'3'}},approvedCases:[]};
  const controlPath=stateRoot+'/run.control.json',loginPath=stateRoot+'/run.login.txt';
  const control={schemaVersion:'agentmo.pi-owned-control.v1',runId,activationPlanDigest:plan.installPlanDigest,rootIdentity:plan.predecessor.rootIdentity,chatPort:19492,stopCapability:'a'.repeat(64)},controlBytes=Buffer.from(JSON.stringify(control));
  const deps={sdk:{loadPiSdk:async()=>{await pause('sdk');return{};}},host:{createPiSessionHost:async()=>{await pause('host');trace.push('host-created');return{close:async()=>trace.push('host-closed')};}},server:{startPiChatServer:async()=>{trace.push('server-started');await pause('server');return{close:async()=>trace.push('server-closed')};}}};
  const names=['process','randomUUID','UUID','reject','piKeys','loadPiNativeSources','preflightPiNative','verifyNativeAuthorityConsumption','basePath','readPiPrivateFile','piHash','isDeepStrictEqual','validatePiPublicTurn','deps','runPiStartupStep'];
  const run=new Function(...names,body+'\nreturn runOwnedPiChild;')(fake,randomUUID,/^[a-f0-9-]{36}$/u,()=>{throw new Error('synthetic rejected');},piKeys,async()=>({planAdmission:{value:plan},sourceAdmissions:{targetDescriptor:{}}}),async()=>{},async()=>{},()=>stateRoot+'/run',async file=>({bytes:file===controlPath?controlBytes:Buffer.from('b'.repeat(48))}),piHash,isDeepStrictEqual,()=>true,deps,runPiStartupStep);
  await run();fake.emit('message',{type:'init',runId,sourceFiles:{},targetPaths:{},stateRoot,authorityRoot:stateRoot+'/authority',budgetRoot:stateRoot+'/budget',controlPath,controlDigest:piHash(controlBytes),loginPath,consumptionDigest:piHash('consumed')});
  if(!failReport){await waiting;fake.emit('message',{type:'shutdown',runId});await tick();release();}
  for(let i=0;i<20;i++)await tick();
  assert.equal(trace.includes('ready'),false,phase+': '+trace.join(','));
  assert.equal(trace.filter(s=>s==='server-started').length,phase.startsWith('server')?1:0,phase);
  assert.equal(trace.filter(s=>s==='host-closed').length,phase==='sdk'?0:1,phase);
  assert.equal(trace.filter(s=>s==='server-closed').length,phase.startsWith('server')?1:0,phase);
  assert.equal(trace.at(-1),'disconnect',phase);assert.equal(fake.exitCode,failReport?1:0,phase);
 }
});

test('a prepared approved fresh session can submit its first turn exactly once',async t=>{
 const {piBudgetFixture}=await local('test/helpers/pi-budget-fixture.js');const {fakePiSdk,finalMessage}=await local('test/helpers/pi-sdk-fixture.js');
 const {createPiSessionHost}=await local('src/pi-session-host.js');const {createPiTurnController,createPiBudgetHandler}=await local('src/pi-budget-proxy.js');const {piHttpRequest}=await local('test/helpers/pi-http-fixture.js');
 const priorMask=process.umask(0o077);t.after(()=>process.umask(priorMask));const f=await piBudgetFixture(t),fake=fakePiSdk();
 await mkdir(path.join(f.stateRoot,'sessions'),{mode:0o700});await writeFile(path.join(f.stateRoot,'system.md'),'合成会议助手',{mode:0o600});
 const initial=await createPiSessionHost({stateRoot:f.stateRoot,binding:f.binding,sdk:fake.sdk,turnClient:f.controller});const {id:sessionId}=await initial.createSession();await initial.close();const before=(await f.summary()).totalReservedFen;
 const approvedCases=[{caseId:'entry',sessionId,inputDigest:piHash(f.text)}],controller=await createPiTurnController({binding:f.binding,stateRoot:f.stateRoot,approvedCases});
 const host=await createPiSessionHost({stateRoot:f.stateRoot,binding:f.binding,sdk:fake.sdk,turnClient:controller,approvedCases});t.after(()=>host.close());
 const handler=createPiBudgetHandler({binding:f.binding,stateRoot:f.stateRoot,budgetRoot:f.budgetRoot,apiKey:'synthetic-only',controller});let requests=0;const prior=globalThis.fetch;
 globalThis.fetch=async()=>{requests++;return new Response(JSON.stringify({model:'MiniMax-M3',choices:[{index:0,message:{role:'assistant',content:'合成最终回复'},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:3,total_tokens:23}}));};t.after(()=>{globalThis.fetch=prior;});
 fake.sequence(async()=>{const result=await piHttpRequest(handler,{model:'MiniMax-M3',stream:false,max_tokens:2048,messages:[{role:'user',content:f.text}]},{authorization:`Bearer ${fake.calls.credential.at(-1).credential}`});assert.equal(result.statusCode,200);return[{type:'message_end',message:finalMessage()},{type:'agent_settled',aborted:false}];});
 const turnId=randomUUID();await host.submit({caseId:'entry',sessionId,turnId,text:f.text});const events=[];for await(const value of host.events(turnId))events.push(value);
 assert.equal(events.at(-1).status,'completed');assert.equal(fake.calls.prompt.length,1);assert.equal(requests,1);assert.equal((await f.summary()).totalReservedFen-before,31);
 const {unlink}=await import('node:fs/promises');const meta=JSON.parse(await readFile(path.join(f.stateRoot,'sessions',sessionId,'sdk-session.json'),'utf8'));
 await unlink(path.join(f.stateRoot,'sessions',sessionId,meta.fileName));await assert.rejects(host.readSession(sessionId));assert.equal(fake.calls.prompt.length,1);
});

test('conformance remembers every denied fetch and socket even when callers swallow errors',async()=>{
 const script=await local('scripts/pi-sdk-conformance.js');assert.equal(typeof script.createPiConformanceNetworkGuard,'function');
 let fetches=0,sockets=0;const guard=script.createPiConformanceNetworkGuard({fetch:async()=>{fetches++;return new Response('{}');},connect:()=>{sockets++;},completion:async()=>new Response('{}')});
 await assert.rejects(guard.fetch('https://example.invalid/background'));assert.throws(()=>guard.connect({host:'example.invalid',port:443}));
 assert.equal(fetches,0);assert.equal(sockets,0);assert.equal(guard.counts().deniedAttempts,2);assert.throws(()=>guard.assertClean());
 await guard.fetch('https://api.minimax.cn/v1/chat/completions',{});assert.equal(guard.counts().upstreamRequests,1);assert.equal(guard.counts().deniedAttempts,2);assert.throws(()=>guard.assertClean());
});
test('conformance timeout waits for abort and disconnect fails after a partial stream',async()=>{
 const script=await local('scripts/pi-sdk-conformance.js');assert.equal(typeof script.piConformanceMockResponse,'function');
 const abort=new AbortController(),observations=[];let settled=false;
 const pending=script.piConformanceMockResponse('timeout',abort.signal,x=>observations.push(x));pending.finally(()=>{settled=true;}).catch(()=>{});
 await tick();assert.equal(settled,false);abort.abort();await assert.rejects(pending);assert.deepEqual(observations,['timeout-abort']);
 const reply=await script.piConformanceMockResponse('disconnect',new AbortController().signal,x=>observations.push(x)),reader=reply.body.getReader();
 assert.ok((await reader.read()).value.length>0);await assert.rejects(reader.read());assert.ok(observations.includes('partial-stream-disconnect'));
});
test('fixed SDK conformance includes host recovery and all bounded input classes',async()=>{
 const script=await local('scripts/pi-sdk-conformance.js');
 const ids=script.PI_CONFORMANCE_CASES.map(c=>typeof c==='string'?c:c.id);
 for(const id of ['success','401','429','500','timeout','disconnect','malformed','empty-input','at-limit-input','over-limit-input','full-request-limit','history-limit'])assert.ok(ids.includes(id),id);
 assert.ok(script.PI_CONFORMANCE_MAX_MS>script.PI_CONFORMANCE_IDLE_MS);
});

async function conformanceWithFakeSdk(t, deniedOnDispose = false) {
  const fs = await import('node:fs/promises'), { tmpdir } = await import('node:os');
  const script = await local('scripts/pi-sdk-conformance.js');
  const budget = await local('src/course-wiki-budget.js'), proxy = await local('src/pi-budget-proxy.js');
  const { createPiSessionHost } = await local('src/pi-session-host.js');
  const { piBytes, piReject, readPiPrivateFile } = await local('src/pi-install-plan.js');
  const { writeNativeChatFile } = await local('src/native-chat-files.js');
  const { piFinalText } = await local('src/pi-sdk.js');
  const { fakePiSdk, finalMessage } = await local('test/helpers/pi-sdk-fixture.js');
  const { piHttpRequest } = await local('test/helpers/pi-http-fixture.js');
  const workspaceRoot = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'pi-fake-conformance-')));
  t.after(() => fs.rm(workspaceRoot, { recursive: true, force: true }));
  const priorMask = process.umask(0o077); t.after(() => process.umask(priorMask));
  const fake = fakePiSdk(), priorFetch = globalThis.fetch;
  let handler;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, 'http://127.0.0.1:19593/v1/chat/completions');
    const reply = await piHttpRequest(handler, Buffer.from(init.body), { host: '127.0.0.1:19593', authorization: init.headers.authorization });
    return new Response(reply.text(), { status: reply.statusCode, headers: reply.headers });
  };
  t.after(() => { globalThis.fetch = priorFetch; });
  fake.sequence(async () => {
    const { context } = fake.calls.stream.at(-1);
    const messages = context.messages.map(message => ({ role: message.role, content: typeof message.content === 'string'
      ? message.content : message.content.map(part => part.text).join('') }));
    const reply = await globalThis.fetch('http://127.0.0.1:19593/v1/chat/completions', {
      headers: { authorization: `Bearer ${fake.calls.credential.at(-1).credential}` },
      body: JSON.stringify({ model: 'MiniMax-M3', stream: true, max_tokens: 2048, messages }),
    });
    if (reply.status !== 200) throw new Error('synthetic SDK rejected proxy failure');
    await reply.text();
    return [{ type: 'message_end', message: finalMessage() }, { type: 'agent_settled', aborted: false }];
  });
  if (deniedOnDispose) {
    const create = fake.sdk.createAgentSession;
    fake.sdk.createAgentSession = async options => {
      const result = await create(options), dispose = result.session.dispose;
      result.session.dispose = async () => {
        await globalThis.fetch('https://example.invalid/background').catch(() => {}); await dispose();
      };
      return result;
    };
  }
  const source = await readFile('scripts/pi-sdk-conformance.js', 'utf8');
  const start = source.indexOf('async function ownedConformance('), end = source.indexOf('\nif (process.argv[1]', start);
  const valid = source.slice(source.indexOf('function validResult('), start);
  const preview = { target: { closure: { runtimeSourceDigest: piHash('fake-runtime') } } };
  const inputs = {
    previewFor: async () => preview, piHash, piBytes, check: value => { if (!value) piReject(); },
    lstat: fs.lstat, process, admitCapturedArtifactBytes: () => ({ digest: piHash('fake-target') }),
    net: await import('node:net').then(module => module.default), createPiConformanceNetworkGuard: script.createPiConformanceNetworkGuard,
    SYNTHETIC_INPUT: '合成会议', SYSTEM: '只输出合成会议结果，未知值写未说明。',
    piConformanceMockResponse: async (mode, signal, observe) => {
      if (mode !== 'timeout') return script.piConformanceMockResponse(mode, signal, observe);
      // Fast cancellation tests orchestration only; the real 90-second deadline remains unexecuted.
      const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 5);
      try { return await script.piConformanceMockResponse(mode, abort.signal, observe); } finally { clearTimeout(timer); }
    },
    loadPiSdk: async () => fake.sdk, path, mkdir: fs.mkdir, ...budget, randomUUID,
    PI_CONFORMANCE_CASES: script.PI_CONFORMANCE_CASES, PORT: 19593, createPiTurnController: proxy.createPiTurnController,
    createPiSessionHost, writeNativeChatFile, readPiPrivateFile, piFinalText,
    startPiBudgetProxy: async options => {
      handler = proxy.createPiBudgetHandler(options); return { summary: handler.summary, close: async () => handler.close() };
    },
    piConformanceExpectedCase: script.piConformanceExpectedCase, PI_CONFORMANCE_IDLE_MS: 0,
    PI_CONFORMANCE_MAX_MS: script.PI_CONFORMANCE_MAX_MS, wait: async () => {}, piKeys, isDeepStrictEqual,
    isBoundary: id => ['full-request-limit', 'history-limit'].includes(id),
    caseInput: id => id === 'empty-input' ? '' : id === 'at-limit-input' ? '😀'.repeat(8000)
      : id === 'over-limit-input' ? '😀'.repeat(8001) : '合成会议',
  };
  const run = new Function(...Object.keys(inputs), valid + source.slice(start, end) + '\nreturn ownedConformance;')(...Object.values(inputs));
  return { workspaceRoot, run: () => run({ preview, targetPaths: {}, workspaceRoot, approvedPreviewDigest: piHash(piBytes(preview)) }, new AbortController()) };
}

test('fixed conformance orchestration reaches all 12 classes through host recovery and official fixture history', async t => {
  const f = await conformanceWithFakeSdk(t), script = await local('scripts/pi-sdk-conformance.js');
  const result = await f.run();
  assert.deepEqual(result.caseResults, script.PI_CONFORMANCE_CASES.map(script.piConformanceExpectedCase));
  assert.equal(result.caseResults.reduce((sum, row) => sum + row.modelRequests, 0), 10);
});
test('conformance refuses a success receipt for swallowed egress during SDK disposal', async t => {
  const f = await conformanceWithFakeSdk(t, true); await assert.rejects(f.run());
  await assert.rejects(import('node:fs/promises').then(fs => fs.access(path.join(f.workspaceRoot, 'conformance.result.json'))));
});

test('conformance deadline stops only its owned child with bounded escalation', async () => {
  const source = await readFile('scripts/pi-sdk-conformance.js', 'utf8');
  const start = source.indexOf('export async function runPiSdkConformance('), end = source.indexOf('\nfunction validResult(', start);
  const script = await local('scripts/pi-sdk-conformance.js'), { piBytes } = await local('src/pi-install-plan.js');
  const child = new EventEmitter(), messages = [], signals = [], timers = new Map();
  Object.assign(child, { connected: true, send(message, done) { messages.push(message.type); done?.(); }, kill(signal) { signals.push(signal); } });
  const preview = { synthetic: true }, workspaceRoot = '/private/tmp/synthetic-only-conformance', targetPaths = { nodeExecutablePath: '/synthetic/node' };
  const inputs = { check: assert.ok, piKeys, piHash, piBytes, isDeepStrictEqual,
    buildPiSdkConformancePreview: async () => preview, mkdir: async () => {}, writeNativeChatFile: async () => {}, path,
    spawn: () => child, MODULE: '/synthetic/conformance.js', piChildEnvironment: () => ({}),
    setTimeout: (fn, ms) => { timers.set(ms, fn); return ms; }, clearTimeout: ms => timers.delete(ms),
    PI_CONFORMANCE_MAX_MS: script.PI_CONFORMANCE_MAX_MS, validResult: () => false,
  };
  const run = new Function(...Object.keys(inputs), source.slice(start, end).replace('export ', '') + '\nreturn runPiSdkConformance;')(...Object.values(inputs));
  const pending = run({ preview, approvedPreviewDigest: piHash(piBytes(preview)), targetPaths, workspaceRoot });
  const rejected = assert.rejects(pending, { code: 'PI_CONFORMANCE_FAILED' }); await tick();
  timers.get(script.PI_CONFORMANCE_MAX_MS)(); assert.deepEqual(messages, ['init', 'stop']);
  timers.get(10000)(); timers.get(15000)(); assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  child.emit('close', null, 'SIGKILL'); await rejected; assert.equal(timers.size, 0);
});
