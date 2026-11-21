import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,realpath,mkdir,writeFile,readFile,symlink,link,rm} from 'node:fs/promises';
import path from 'node:path';import {tmpdir} from 'node:os';
import {workspacePolicy} from './helpers/pi-workspace-fixture.js';
async function fixture(t){const root=await realpath(await mkdtemp(path.join(tmpdir(),'pi-workspace-')));t.after(()=>rm(root,{recursive:true,force:true}));await mkdir(path.join(root,'input'),{mode:0o700});await mkdir(path.join(root,'attempt'),{mode:0o700});await writeFile(path.join(root,'input','one.md'),'Alpha\nEvidence\n');await writeFile(path.join(root,'input','two.txt'),'Missing deadline\n');return root;}
test('capture uses bounded immutable snapshots and confirmation rejects changed originals',async t=>{
 const api=await import('../src/pi-workspace-files.js'),root=await fixture(t);
 const snapshot=await api.captureWorkspace({sourceRoot:path.join(root,'input'),relativePaths:['one.md','two.txt'],skill:workspacePolicy().skill});
 assert.equal(snapshot.sources.length,2);assert.equal(snapshot.sources[0].logicalPath,'sources/1.md');assert.equal(snapshot.sources[0].lineCount,3);
 await api.revalidateWorkspace({snapshot});await writeFile(path.join(root,'input','one.md'),'changed');await assert.rejects(api.revalidateWorkspace({snapshot}));assert.equal(snapshot.sources[0].text,'Alpha\nEvidence\n');
});
test('capture rejects aliases, forbidden paths, malformed text and oversize input',async t=>{
 const api=await import('../src/pi-workspace-files.js'),root=await fixture(t),sourceRoot=path.join(root,'input');
 await symlink(path.join(sourceRoot,'one.md'),path.join(sourceRoot,'alias.md'));await link(path.join(sourceRoot,'two.txt'),path.join(sourceRoot,'hard.txt'));
 await writeFile(path.join(sourceRoot,'big.md'),'x'.repeat(4097));await writeFile(path.join(sourceRoot,'bad.md'),Buffer.from([255]));
 for(const relativePath of ['../one.md','.env','alias.md','hard.txt','big.md','bad.md','https://example.invalid/a.md'])await assert.rejects(api.captureWorkspace({sourceRoot,relativePaths:[relativePath],skill:workspacePolicy().skill}));
});
test('read/write tool policy stages only cited approved bytes and permanently closes on error',async t=>{
 const api=await import('../src/pi-workspace-files.js'),root=await fixture(t),policy=workspacePolicy();
 const snapshot=await api.captureWorkspace({sourceRoot:path.join(root,'input'),relativePaths:['one.md'],skill:policy.skill});
 const binding={taskId:'task-1',sessionId:'session-1',snapshotDigest:snapshot.snapshotDigest,policy};
 const tools=api.createWorkspaceTools({binding,snapshot,attemptRoot:path.join(root,'attempt'),admittedHistoryRecords:[],signal:new AbortController().signal});
 const call=(id,name,args)=>tools.execute({taskId:'task-1',sessionId:'session-1',toolCallId:id,name,args});
 const read=await call('r','read',{path:'sources/1.md'});assert.equal(read.text,'Alpha\nEvidence\n');
 const content='# Report\nAlpha [source-1:L1-L2]\n';
 const result=await call('w','write',{path:'output/report.md',content});assert.equal(result.status,'staged');assert(!JSON.stringify(result).includes('Alpha'));
 assert.equal(await readFile(path.join(root,'attempt','report.staged.md'),'utf8'),content);
 await assert.rejects(call('w2','write',{path:'output/report.md',content}));await assert.rejects(call('r2','read',{path:'sources/1.md'}));
});
test('unread citations, ninth tool, replay and cancellation are rejected',async t=>{
 const api=await import('../src/pi-workspace-files.js'),root=await fixture(t),policy=workspacePolicy();
 const snapshot=await api.captureWorkspace({sourceRoot:path.join(root,'input'),relativePaths:['one.md'],skill:policy.skill});
 for(const mode of ['unread','limit','duplicate','cancel','extra-read-argument']){
  const abort=new AbortController(),tools=api.createWorkspaceTools({binding:{taskId:'t',sessionId:'s',snapshotDigest:snapshot.snapshotDigest,policy},snapshot,attemptRoot:path.join(root,'attempt'),admittedHistoryRecords:[],signal:abort.signal});
  const call=(id,name='read',args={path:'sources/1.md'})=>tools.execute({taskId:'t',sessionId:'s',toolCallId:id,name,args});
  if(mode==='unread')await assert.rejects(call('w','write',{path:'output/report.md',content:'[source-1:L1-L1]'}));
  if(mode==='limit'){for(let i=0;i<8;i++)await call(String(i));await assert.rejects(call('9'));}
  if(mode==='duplicate'){await call('1');await assert.rejects(call('1'));}
  if(mode==='cancel'){abort.abort();await assert.rejects(call('1'));}
  if(mode==='extra-read-argument')await assert.rejects(call('1','read',{path:'sources/1.md',unapproved:true}));
 }
});

test('body references generate canonical report bytes and the citation list',async t=>{
 const {captureWorkspace,createWorkspaceTools}=await import('../src/pi-workspace-files.js');
 const {piHash}=await import('../src/pi-install-plan.js');
 const root=await fixture(t),policy=workspacePolicy(),attemptRoot=path.join(root,'attempt');
 const snapshot=await captureWorkspace({sourceRoot:path.join(root,'input'),relativePaths:['one.md','two.txt'],skill:policy.skill});
 const tools=createWorkspaceTools({binding:{taskId:'t',sessionId:'s',snapshotDigest:snapshot.snapshotDigest,policy},snapshot,attemptRoot});
 const call=(toolCallId,name,args)=>tools.execute({taskId:'t',sessionId:'s',toolCallId,name,args});
 await call('r1','read',{path:'sources/1.md'});
 await call('r2','read',{path:'sources/2.md'});
 const args={path:'output/report.md',content:'Second line [source-1:L2]. Range [source-1:L1-L2]. Repeat [source-1:L2-L2]. Gap [source-2:L1].'};
 const expected='Second line [source-1:L2-L2]. Range [source-1:L1-L2]. Repeat [source-1:L2-L2]. Gap [source-2:L1-L1].';
 const citations=[{sourceId:'source-1',startLine:2,endLine:2},{sourceId:'source-1',startLine:1,endLine:2},{sourceId:'source-2',startLine:1,endLine:1}];
 const expectedResult={status:'staged',contentDigest:piHash(expected),byteLength:Buffer.byteLength(expected),citations};
 assert.deepEqual(await call('w','write',args),expectedResult);
 assert.equal(await readFile(path.join(attemptRoot,'report.staged.md'),'utf8'),expected);
 assert.deepEqual(tools.staged.citations,citations);
 assert.deepEqual(tools.records.at(-1).args,args);
 assert.deepEqual(tools.records.at(-1).result,expectedResult);
});

test('invalid body references stop the write before staging anything',async t=>{
 const {captureWorkspace,createWorkspaceTools}=await import('../src/pi-workspace-files.js');
 const root=await fixture(t),policy=workspacePolicy(),attemptRoot=path.join(root,'attempt'),sourceRoot=path.join(root,'input');
 await writeFile(path.join(sourceRoot,'one.md'),Array(16).fill('Evidence').join('\n'));
 const snapshot=await captureWorkspace({sourceRoot,relativePaths:['one.md','two.txt'],skill:policy.skill});
 const valid='Evidence [source-1:L1]';
 const ranges=Array.from({length:16},(_,i)=>Array.from({length:16-i},(_,j)=>`[source-1:L${i+1}-L${i+j+1}]`)).flat();
 const invalid=[
  ['missing references',{content:'No references'}],
  ['unread source',{content:valid+' [source-2:L1]'}],
  ['unknown source',{content:valid+' [source-3:L1]'}],
  ['skill is method only',{content:valid+' [skill:L1]'}],
  ['past end of source',{content:valid+' [source-1:L1-L17]'}],
  ['reversed range',{content:valid+' [source-1:L2-L1]'}],
  ['zero line',{content:valid+' [source-1:L0]'}],
  ['invalid end line syntax',{content:valid+' [source-1:L1-2]'}],
  ['unclosed marker',{content:valid+' [source-1:L2'}],
  ['normalized output too large',{content:valid+'x'.repeat(8192-valid.length)}],
  ['too many distinct citations',{content:ranges.slice(0,129).join(' ')}],
  ['second citation source',{content:'Evidence [source-1:L1-L1]',citations:[{sourceId:'source-1',startLine:1,endLine:1}]}],
 ];
 for(const [reason,args] of invalid){
  const tools=createWorkspaceTools({binding:{taskId:'t',sessionId:'s',snapshotDigest:snapshot.snapshotDigest,policy},snapshot,attemptRoot});
  const call=(toolCallId,name,args)=>tools.execute({taskId:'t',sessionId:'s',toolCallId,name,args});
  await call('r','read',{path:'sources/1.md'});
  await call('skill','read',{path:'skills/project-brief/SKILL.md'});
  await assert.rejects(call('w','write',{path:'output/report.md',...args}),{code:'AGENTMO_PI_WORKSPACE_REJECTED'},reason);
  assert.equal(tools.staged,null,reason);
  await assert.rejects(readFile(path.join(attemptRoot,'report.staged.md')),{code:'ENOENT'});
 }
});
