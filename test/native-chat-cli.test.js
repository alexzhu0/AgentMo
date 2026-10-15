import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { it } from 'node:test';
import { activationFixture } from './helpers/native-chat-fixture.js';
import { buildRuntimePlan } from '../src/runtime-plan.js';
import { loadAdmittedArtifact } from '../src/artifact-admission.js';

const hash = b => `sha256:${createHash('sha256').update(b).digest('hex')}`;
const cwd = new URL('..', import.meta.url);
const cli = args => spawnSync(process.execPath, ['bin/agentmo.js', ...args], { cwd, encoding:'utf8', timeout:45_000 });

it('previews exact activation, serves in foreground and stops through the public authenticated command', async t => {
  const {root,fixture:f,probe,options:o}=await activationFixture(t);
  const pairs={};
  async function artifact(name,value){const file=path.join(root,`${name}.json`),data=Buffer.from(`${JSON.stringify(value,null,2)}\n`);await writeFile(file,data);pairs[name]=[`--${name}`,file,`--${name}-sha256`,hash(data)];}
  for(const [name,value] of Object.entries({probe,request:{target:o.plan.target,nativeBinding:o.plan.nativeBinding,authorityRootBinding:o.plan.authorityRootBinding},'install-plan':o.plan,'install-receipt':o.installReceipt,'ordinary-approval':o.ordinaryApproval,'conflict-approval':o.conflictApproval}))await artifact(name,value);
  for(const [i,value] of o.sensitiveDecisions.entries())await artifact(`sensitive-${i}`,value);
  const sources=[['blueprint','blueprint'],['build-contract','build-contract'],['plan-approval','plan-approval'],['target-descriptor','openclaw-target-descriptor'],['target-carrier-admission','openclaw-target-carrier-admission']].flatMap(([flag,key])=>[`--${flag}`,f.paths[key],`--${flag}-sha256`,f.digests[key]]);
  const common=['--execution-profile','native-chat','--lifecycle','activate','--archive',o.archivePath,'--archive-sha256',o.plan.archiveBinding.archiveSha256,...sources,...pairs.probe,...pairs['install-receipt'],'--target-root',o.stateRoot,'--openclaw-target-root',path.dirname(o.executablePath),'--budget-root',o.budgetRoot,'--native-authority-root',o.authorityRoot];
  const previewPath=path.join(root,'activation-preview.json');
  const preview=cli(['openclaw-install-preview',...common,...pairs.request,'--out',previewPath,'--json']);
  assert.equal(preview.status,0,preview.stderr);assert.deepEqual(JSON.parse(await readFile(previewPath,'utf8')),o.plan);
  const envPath=path.join(root,'synthetic-runtime-input');await writeFile(envPath,'DEEPSEEK_API_KEY=synthetic-cli-provider-key\n',{mode:0o600});
  const args=['openclaw-native','serve',...common,...pairs['install-plan'],...pairs['ordinary-approval'],...pairs['conflict-approval'],...o.sensitiveDecisions.flatMap((_,i)=>['--sensitive-decision',pairs[`sensitive-${i}`][1],'--sensitive-decision-sha256',pairs[`sensitive-${i}`][3]]),'--runtime-env-file',envPath,'--json'];
  const journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
  for(const invalid of [args.map(v=>v===pairs['install-receipt'][3]?hash('wrong'):v),args.map(v=>v==='--runtime-env-file'?'--env-file':v)]){
    const result=cli(invalid);assert.notEqual(result.status,0);assert.ok(!result.stderr.includes('synthetic-cli-provider-key'));assert.deepEqual(await readFile(journal),before);
  }
  const child=spawn(process.execPath,['bin/agentmo.js',...args],{cwd,stdio:['ignore','pipe','pipe']});
  const ended=new Promise(resolve=>child.once('close',(code,signal)=>resolve({code,signal})));
  t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');await ended;});
  let stdout='',stderr='';child.stderr.on('data',b=>{stderr+=b;});
  const entry=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Native entry deadline exceeded')),30_000);
    child.stdout.on('data',b=>{stdout+=b;if(stdout.includes('\n')){clearTimeout(timer);try{resolve(JSON.parse(stdout.trim()));}catch(e){reject(e);}}});
    child.once('close',()=>{clearTimeout(timer);reject(new Error(`Native serve exited: ${stderr}`));});
  });
  assert.equal(entry.agentId,o.plan.nativeBinding.agentId);assert.ok(!stdout.includes('synthetic-cli-provider-key'));
  assert.equal((await fetch(`http://127.0.0.1:${o.plan.nativeBinding.gatewayPort}/readyz`)).status,200);
  const stopped=cli(['openclaw-native','stop',...pairs['install-plan'],'--target-root',o.stateRoot,'--json']);
  assert.equal(stopped.status,0,stopped.stderr);assert.deepEqual(JSON.parse(stopped.stdout),{stopped:true});
  assert.deepEqual(await ended,{code:0,signal:null});assert.equal(stderr,'');
});

it('keeps native chat out of the legacy one-shot run-plan path',async t=>{
  const {fixture:f}=await activationFixture(t);
  const admission=await loadAdmittedArtifact({filePath:f.paths.blueprint,subject:'blueprint',expectedDigest:f.digests.blueprint});
  await assert.rejects(buildRuntimePlan(admission.value,{admission,workspace:'/tmp/synthetic-native-workspace',message:'synthetic'}),/openclaw-native/u);
});

it('SIGTERM during readiness or health startup closes owned processes and both ports without an entry',async t=>{
  const {gatewaySource}=await import('./helpers/native-chat-fixture.js');
  const {setTimeout:delay}=await import('node:timers/promises');
  for(const stage of ['readiness','health']){
    const cleanup="if(req.url==='/synthetic-cleanup'){res.end('closed');server.close(()=>process.exit(0));return;} ";
    let source=gatewaySource.replace("if(req.url==='/readyz'){res.end(JSON.stringify({ready:true}));return;}",cleanup+(stage==='readiness'?"if(req.url==='/readyz'){res.writeHead(503);res.end('pending');return;}":"if(req.url==='/readyz'){res.end(JSON.stringify({ready:true}));return;}"));
    if(stage==='health')source=source.replace("console.log(await response.text());",`await fs.writeFile(path.join(root,'health-pending'),'pending');
      while(true){await new Promise(resolve=>setTimeout(resolve,25));try{await fetch('http://127.0.0.1:'+port+'/readyz',{signal:AbortSignal.timeout(100)});}catch{process.exit(0);}}`);
    const {root,fixture:f,probe,options:o}=await activationFixture(t,source),pairs={};
    for(const [name,value] of Object.entries({probe,'install-plan':o.plan,'install-receipt':o.installReceipt,'ordinary-approval':o.ordinaryApproval,'conflict-approval':o.conflictApproval,...Object.fromEntries(o.sensitiveDecisions.map((v,i)=>['sensitive-'+i,v]))})){
      const file=path.join(root,name+'.json'),data=Buffer.from(JSON.stringify(value,null,2)+'\n');await writeFile(file,data);pairs[name]=['--'+name,file,'--'+name+'-sha256',hash(data)];
    }
    const sources=[['blueprint','blueprint'],['build-contract','build-contract'],['plan-approval','plan-approval'],['target-descriptor','openclaw-target-descriptor'],['target-carrier-admission','openclaw-target-carrier-admission']].flatMap(([flag,key])=>['--'+flag,f.paths[key],'--'+flag+'-sha256',f.digests[key]]);
    const input=path.join(root,'synthetic-runtime-input');await writeFile(input,'DEEPSEEK_API_KEY=synthetic-startup-key\n',{mode:0o600});
    const args=['bin/agentmo.js','openclaw-native','serve','--execution-profile','native-chat','--lifecycle','activate','--archive',o.archivePath,'--archive-sha256',o.plan.archiveBinding.archiveSha256,...sources,...pairs.probe,...pairs['install-receipt'],'--target-root',o.stateRoot,'--openclaw-target-root',path.dirname(o.executablePath),'--budget-root',o.budgetRoot,'--native-authority-root',o.authorityRoot,...pairs['install-plan'],...pairs['ordinary-approval'],...pairs['conflict-approval'],...o.sensitiveDecisions.flatMap((_,i)=>['--sensitive-decision',pairs['sensitive-'+i][1],'--sensitive-decision-sha256',pairs['sensitive-'+i][3]]),'--runtime-env-file',input,'--json'];
    const journal=path.join(o.authorityRoot,'consumption.jsonl'),before=await readFile(journal);
    const child=spawn(process.execPath,args,{cwd,stdio:['ignore','pipe','pipe']});let stdout='';child.stdout.on('data',b=>{stdout+=b;});child.stderr.resume();
    const ended=new Promise(resolve=>child.once('exit',(code,signal)=>resolve({code,signal})));
    const base='http://127.0.0.1:'+o.plan.nativeBinding.gatewayPort;
    t.after(async()=>{if(child.exitCode===null&&child.signalCode===null)child.kill('SIGTERM');try{await fetch(base+'/synthetic-cleanup',{signal:AbortSignal.timeout(1000)});}catch{}});
    let pending=false;for(let i=0;i<120;i++){
      try{if(stage==='health'){await readFile(path.join(o.stateRoot,'health-pending'));pending=true;break;}
        const r=await fetch(base+'/readyz',{signal:AbortSignal.timeout(100)});await r.body.cancel();if(r.status===503){pending=true;break;}}
      catch{}await delay(50);
    }
    assert.equal(pending,true,`${stage} pending`);const consumed=await readFile(journal);assert.notDeepEqual(consumed,before);
    child.kill('SIGTERM');const exit=await ended;
    let alive=false;try{const r=await fetch(base+'/readyz',{signal:AbortSignal.timeout(500)});alive=true;await r.body.cancel();}catch{}
    if(alive)await fetch(base+'/synthetic-cleanup',{signal:AbortSignal.timeout(1000)}).catch(()=>{});
    assert.equal(alive,false,`${stage}: owned gateway must close`);assert.deepEqual(exit,{code:0,signal:null});assert.equal(stdout,'');
    await assert.rejects(fetch(`http://127.0.0.1:${o.plan.nativeBinding.proxyPort}/v1/chat/completions`));
    assert.deepEqual(await readFile(journal),consumed);
  }
});
