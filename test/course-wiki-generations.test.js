import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,realpath,mkdir,readFile,writeFile,rm,readdir,chmod} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import * as runtime from '../src/course-wiki-openclaw.js';
import {normalizeDocument} from '../src/course-wiki-documents.js';
import {initializeCourseBudget,initializeCourseProjectBudget,courseBudgetSummary,startCourseBudget} from '../src/course-wiki-budget.js';

// Native process boundary double: it retains real on-disk source/apply state, not
// provider or publication state. A separate smoke uses the installed native CLI.
const nativeFixture=String.raw`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path');
const args=process.argv.slice(2),root=process.cwd();
const control=JSON.parse(fs.readFileSync(path.join(path.dirname(process.argv[1]),'control.json'),'utf8'));
if(control.fail===args[1])process.exit(2);
let output={};fs.mkdirSync(path.join(root,'vault'),{recursive:true});const store=path.join(root,'vault','fixture-pages.json');
const pages=fs.existsSync(store)?JSON.parse(fs.readFileSync(store,'utf8')):{};
if(args[0]==='agents'&&args[1]==='list'){const cfg=JSON.parse(fs.readFileSync(process.env.OPENCLAW_CONFIG_PATH));output=[{id:'course-wiki',model:'deepseek/deepseek-v4-flash',workspace:cfg.agents.defaults.workspace}];}
if(args[0]==='models')output={models:[{key:'deepseek/deepseek-v4-flash'}]};
if(args[1]==='ingest'){const body=fs.readFileSync(args[2],'utf8'),id='source.'+args[args.indexOf('--title')+1];pages[id]={id,sourcePath:args[2],content:'# Source\n\n'+String.fromCharCode(96).repeat(3)+'text\n'+body+'\n'+String.fromCharCode(96).repeat(3)};fs.writeFileSync(store,JSON.stringify(pages));output={pageId:id};}
if(args[1]==='get'){output=pages[args[2]];if(control.forge)output={...output,sourcePath:'/forged',content:'forged'};}
if(args[1]==='search'&&control.delaySearchMs){fs.writeFileSync(path.join(path.dirname(process.argv[1]),'search-started'),'started');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,control.delaySearchMs);fs.writeFileSync(path.join(path.dirname(process.argv[1]),'search-finished'),'finished');}
if(args[1]==='search')output=control.empty?[]:control.unknown?[{id:'source.another-generation'}]:Object.keys(pages).filter(id=>id.startsWith('source.')).map(id=>({id}));
if(args[1]==='apply'){const id='synthesis.'+args[3];pages[id]={id,content:fs.readFileSync(args[args.indexOf('--body-file')+1],'utf8')};fs.writeFileSync(store,JSON.stringify(pages));output={pageId:id};}
if(args[1]==='lint')output={issues:[]};
process.stdout.write(JSON.stringify(output));
`;

async function fixture(t,{realNative=false}={}){
  const base=await realpath(await mkdtemp(path.join(os.tmpdir(),'course-generations-')));t.after(()=>rm(base,{recursive:true,force:true}));
  const executable=path.join(base,'native.cjs');await writeFile(executable,nativeFixture);await chmod(executable,0o700);await writeFile(path.join(base,'control.json'),'{}');
  const legacy=path.join(base,'legacy'),budgetRoot=path.join(base,'project');await mkdir(legacy);await mkdir(budgetRoot);await initializeCourseBudget({root:legacy});
  const {budgetReference}=await initializeCourseProjectBudget({root:budgetRoot,legacyRoots:[legacy]});
  const root=path.join(base,'runtime'),projectBudget={budgetRoot,budgetReference};
  await runtime.prepareCourseWorkspace({root,executable:realNative?'/Users/alexzhu/.local/bin/openclaw':executable,projectBudget});
  await mkdir(path.join(root,'gateway'));await mkdir(path.join(root,'gateway','attempts'));
  const liveAuthorization={authorized:true,campaign:'course-wiki-selected-documents-v1',root};
  return {root,base,projectBudget,liveAuthorization,apiKey:'synthetic-only',summary:()=>courseBudgetSummary({root:budgetRoot,budgetReference}),control:value=>writeFile(path.join(base,'control.json'),JSON.stringify(value))};
}
async function document(text='Nouns name things.',name='lesson.txt'){return normalizeDocument({name,bytes:Buffer.from(text)});}
function consent(preview){return {version:1,corpusDigest:preview.corpusDigest,provider:'deepseek',purpose:'wiki-and-qa',confirmed:true};}
function provider(t,respond){const original=globalThis.fetch;let calls=0;t.mock.method(globalThis,'fetch',async(url,options)=>{if(!String(url).startsWith('https:'))return original(url,options);calls++;const input=JSON.parse(options.body);assert.ok(Buffer.byteLength(options.body)<=48*1024);const answer=await respond(input,calls);return new Response(JSON.stringify({model:'deepseek-flash',choices:[{message:{content:JSON.stringify(answer)},finish_reason:'stop'}],usage:{prompt_tokens:20,completion_tokens:10,total_tokens:30}}));});return ()=>calls;}
function topic(input){const sourceDigest=input.messages.map(m=>m.content).join('\n').match(/SOURCE (sha256:[a-f0-9]{64})/)[1];return {topics:[{title:'课程主题',body:'这是材料支持的课程主题。',citations:[{sourceDigest,fromLine:1,toLine:1}]}]};}
async function request(root,text='这份资料说了什么？'){return {model:'deepseek-v4-flash',messages:[{role:'system',content:await readFile(path.join(root,'bootstrap/course-wiki-v2/AGENTS.md'),'utf8')},{role:'user',content:text}],stream:true,max_tokens:2048,thinking:{type:'disabled'}};}

test('selected runtime binds one project budget and stages txt/md/docx locally without publication',async t=>{
  assert.equal(typeof runtime.stageCourseCorpus,'function');
  const f=await fixture(t);const converted=spawnSync('/usr/bin/textutil',['-convert','docx','-format','txt','-stdin','-stdout'],{input:'Verbs express action.'});assert.equal(converted.status,0);
  const docs=[await document(),await document('# Adjectives\nAdjectives describe nouns.','lesson.md'),await normalizeDocument({name:'lesson.docx',bytes:converted.stdout})];
  const preview=await runtime.stageCourseCorpus({...f,documents:docs});assert.equal(preview.status,'preview');assert.equal(preview.sources.length,3);assert.equal(preview.duplicate,false);
  assert.equal((await f.summary()).consumedRequests,0);assert.equal((await readdir(f.root)).includes('budget'),false);assert.equal((await readdir(f.root)).includes('active-generation.json'),false);
  const state=await runtime.getCourseCorpus(f);assert.equal(state.active,null);assert.equal(state.pending[0].generationId,preview.generationId);
  for(const doc of docs){const stored=await runtime.getCourseDocument({...f,generationId:preview.generationId,sourceDigest:doc.sourceDigest});assert.equal(stored.text,doc.text);assert.equal(Object.hasOwn(stored,'originalBytes'),false);}
  await assert.rejects(runtime.activateCourseCorpus({...f,generationId:preview.generationId,consent:{...consent(preview),confirmed:false}}),{code:'COURSE_WIKI_CONSENT_REJECTED'});
  assert.equal((await f.summary()).consumedRequests,0);
});

test('generation provider contract requires claim-complete citations and unambiguous source terminology',async t=>{
  const f=await fixture(t),captured=[];
  const calls=provider(t,input=>{captured.push(input);return topic(input);});
  const docs=[await document('A queue preserves arrival order.','queue.txt'),await document('A stack removes the most recent item.','stack.md')];
  const staged=await runtime.stageCourseCorpus({...f,documents:docs});
  const active=await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  assert.equal(calls(),2);assert.equal((await f.summary()).consumedRequests,2);
  for(const [index,input]of captured.entries()){
    assert.equal(input.model,'deepseek-v4-flash');assert.equal(input.max_tokens,2048);assert.equal(input.n,1);assert.equal(input.stream,false);assert.deepEqual(input.thinking,{type:'disabled'});
    assert.equal(input.messages.length,1);assert.equal(input.messages[0].role,'user');
    const prompt=input.messages[0].content;
    assert.match(prompt,/每项实质性主张.*citations.*引用选段支持/u);
    assert.match(prompt,/只写这些选段覆盖的事实.*不得.*未支持的概念/u);
    assert.match(prompt,/多个精确行号范围.*1-3行.*不能取代完整支持/u);
    assert.match(prompt,/标题和正文.*技术术语.*忠于原文/u);
    assert.match(prompt,/有歧义时保留原文英文术语.*不得将不同概念混为一谈/u);
    assert.ok(prompt.includes('{"topics":[{"citations":[],"title":"中文标题","body":"中文正文"}]}'));
    assert.match(prompt,/先选择.*引用.*再.*标题和正文/u);
    assert.match(prompt,/仅.*选中行.*并集.*正文.*依据/u);
    assert.match(prompt,/未选中的原文.*不可用于正文.*省略.*未被引用.*例子/u);
    assert.match(prompt,/sourceDigest,fromLine,toLine/u);assert.match(prompt,/禁止输出quote或其他字段/u);
    assert.match(prompt,/恰好一个主题/u);assert.equal((prompt.match(/SOURCE sha256:/gu)??[]).length,1);
    assert.ok(prompt.includes(docs[index].sourceDigest));assert.ok(prompt.includes(docs[index].text));
  }
  assert.equal(active.topics.length,2);
  const ready=await runtime.readActiveCourseGeneration(f);
  assert.deepEqual(ready.manifest.coveredSourceDigests,docs.map(doc=>doc.sourceDigest).sort());
  for(const [index,item]of active.topics.entries())assert.equal(item.citations[0].sourceDigest,docs[index].sourceDigest);
});

test('selected turns carry trusted product capabilities without using them as teaching evidence',async t=>{
  const f=await fixture(t),bootstrapPath=path.join(f.root,'bootstrap/course-wiki-v2/AGENTS.md');
  const bootstrap=await readFile(bootstrapPath,'utf8');
  assert.match(bootstrap,/Trusted product scope/u);
  assert.match(bootstrap,/local single-user.*single active knowledge base/u);
  assert.match(bootstrap,/document page accepts DOCX, Markdown.*UTF-8 TXT/u);
  assert.match(bootstrap,/not DOC, PDF, PPT, audio or OCR/u);
  assert.match(bootstrap,/local preview.*explicit consent.*exact selected document set.*Wiki generation/u);
  assert.match(bootstrap,/Wiki.*native.*verified sources/u);
  assert.match(bootstrap,/no upload tool/u);
  assert.match(bootstrap,/capabilities.*conversation.*citations=\[\].*not teaching facts/u);
  let answering=false,observed;
  const calls=provider(t,input=>{if(!answering)return topic(input);observed=input;return {kind:'conversation',answer:'请在文档页面选择资料。'};});
  const staged=await runtime.stageCourseCorpus({...f,documents:[await document()]});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  answering=true;const answer=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'你支持什么材料？')});
  assert.equal(observed.messages.length,1);assert.equal(observed.messages[0].role,'user');
  assert.match(observed.messages[0].content,/Trusted product scope: this is a local single-user document assistant/u);
  assert.match(observed.messages[0].content,/DOCX, Markdown \(\.md\), and UTF-8 TXT \(\.txt\), not DOC, PDF, PPT, audio or OCR/u);
  assert.match(observed.messages[0].content,/document page.*explicit consent.*exact selected document set/u);
  assert.match(observed.messages[0].content,/no upload tool/u);
  assert.doesNotMatch(observed.messages[0].content,/## Transport output contract|An adjective is a word/u);
  assert.equal(answer.stageNames.length,1);assert.equal(answer.providerRequestCount,1);
  assert.equal(answer.text,'请在文档页面选择资料。');assert.equal(answer.text.includes('来源 1'),false);
  assert.equal(answer.generationId,staged.generationId);assert.equal(calls(),2);
  assert.equal(await readFile(bootstrapPath,'utf8'),bootstrap);
});

test('selected native provider contract validates citation selections before the separate answer',async t=>{
  const f=await fixture(t),doc=await document('Queues preserve arrival order.','queue.txt');
  let phase='generation',selectionInput,answerInput;
  const calls=provider(t,input=>{
    if(phase==='generation')return topic(input);
    if(input.messages[0].content.includes('grounded-selection')){
      selectionInput=input;
      const sourceDigest=phase==='invalid'?'sha256:'+'0'.repeat(64):doc.sourceDigest;
      return {kind:'grounded-selection',resolvedQuestion:'队列保留什么顺序？',selections:[{sourceDigest,fromLine:1,toLine:1}]};
    }
    answerInput=input;return {answer:'队列保留到达顺序。'};
  });
  const staged=await runtime.stageCourseCorpus({...f,documents:[doc]});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  const files=['bootstrap/course-wiki-v2/AGENTS.md','active-generation.json',...['manifest.json','ready.json','consent.json','workspace-view/WIKI.md'].map(name=>`generations/${staged.generationId}/${name}`)];
  const before=await Promise.all(files.map(name=>readFile(path.join(f.root,name))));
  phase='valid';const input=await request(f.root,'队列保留什么顺序？');input.messages.splice(1,0,{role:'assistant',content:'EARLIER HIDDEN HISTORY CANARY'});
  const answer=await runtime.runCourseGatewayRequest({...f,request:input});
  assert.equal(selectionInput.messages.length,1);assert.equal(selectionInput.messages[0].role,'user');
  assert.match(selectionInput.messages[0].content,/grounded-selection.*resolvedQuestion.*selections/u);
  assert.match(selectionInput.messages[0].content,/SOURCE .*\n1\|Queues preserve arrival order\./u);
  assert.match(selectionInput.messages[0].content,/只选择材料行号，不作最终回答/u);
  assert.equal(answerInput.messages.length,1);assert.equal(answerInput.messages[0].role,'user');
  assert.match(answerInput.messages[0].content,/队列保留什么顺序？/u);
  assert.match(answerInput.messages[0].content,/1\|Queues preserve arrival order\./u);
  assert.equal((answerInput.messages[0].content.match(/^\d+\|/gmu)??[]).length,1);
  assert.doesNotMatch(answerInput.messages[0].content,/EARLIER HIDDEN HISTORY CANARY/u);
  assert.equal(answerInput.model,'deepseek-v4-flash');assert.equal(answerInput.max_tokens,2048);assert.equal(answerInput.stream,false);
  assert.ok(answer.text.includes(doc.text));assert.ok(answer.text.includes(doc.sourceDigest));
  assert.equal(answer.generationId,staged.generationId);assert.deepEqual(answer.stageNames,['small-select','answer']);assert.equal(answer.providerRequestCount,2);assert.equal(calls(),3);
  phase='invalid';const invalid=await request(f.root,'再说明队列顺序。');
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:invalid}),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});
  assert.equal(calls(),4);assert.equal((await f.summary()).consumedRequests,4);
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:invalid}),{code:'COURSE_WIKI_DUPLICATE_REQUEST'});
  assert.equal(calls(),4);
  for(const [index,name]of files.entries())assert.deepEqual(await readFile(path.join(f.root,name)),before[index]);
});

test('selected native product scope assigns Wiki browsing to the document page and questions to native chat',async t=>{
  const f=await fixture(t),bootstrapPath=path.join(f.root,'bootstrap/course-wiki-v2/AGENTS.md'),bootstrap=await readFile(bootstrapPath);
  let answering=false,observed;
  const calls=provider(t,input=>{if(!answering)return topic(input);observed=input;return {kind:'conversation',answer:'请在文档页面浏览，在原生聊天里提问。'};});
  const staged=await runtime.stageCourseCorpus({...f,documents:[await document()]});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  answering=true;const answer=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'在哪里浏览和提问？')});
  const prompt=observed.messages[0].content;
  assert.equal(observed.messages.length,1);assert.equal(observed.messages[0].role,'user');
  assert.match(prompt,/document page[^.]*select\/upload[^.]*preview\/confirm[^.]*browse published Wiki topics[^.]*inspect citations\/source text/u);
  assert.match(prompt,/Use native chat for conversation and source-grounded questions and answers/u);
  assert.match(prompt,/native chat is not the Wiki browser and has no upload tool/u);
  assert.doesNotMatch(prompt,/## Transport output contract|An adjective is a word/u);
  assert.equal(answer.stageNames.length,1);assert.equal(answer.providerRequestCount,1);assert.equal(answer.text,'请在文档页面浏览，在原生聊天里提问。');
  assert.ok(!prompt.includes(bootstrap.toString('utf8').trim()));assert.equal(calls(),2);
  assert.deepEqual(await readFile(bootstrapPath),bootstrap);
});

test('one and four-source complete generations publish atomically, deduplicate by bytes and keep pinned old links',async t=>{
  assert.equal(typeof runtime.activateCourseCorpus,'function');const f=await fixture(t);const calls=provider(t,topic);
  const first=await runtime.stageCourseCorpus({...f,documents:[await document()]});const active=await runtime.activateCourseCorpus({...f,generationId:first.generationId,consent:consent(first)});assert.equal(active.topics.length,1);
  const pointer=await readFile(path.join(f.root,'active-generation.json'));
  const second=await runtime.stageCourseCorpus({...f,documents:await Promise.all(['Cats are nouns.','Bright is an adjective.','Run is a verb.','Quickly is an adverb.'].map((text,i)=>document(text,`source-${i}.txt`)))});
  await f.control({fail:'apply'});await assert.rejects(runtime.activateCourseCorpus({...f,generationId:second.generationId,consent:consent(second)}));assert.deepEqual(await readFile(path.join(f.root,'active-generation.json')),pointer);assert.equal((await runtime.readActiveCourseGeneration(f)).generationId,first.generationId);
  await f.control({});const third=await runtime.stageCourseCorpus({...f,documents:await Promise.all(['Cats are nouns.','Bright is an adjective.','Run is a verb.','Quickly is an adverb.'].map((text,i)=>document(text,`source-${i}.txt`)))});
  const newer=await runtime.activateCourseCorpus({...f,generationId:third.generationId,consent:consent(third)});assert.equal(newer.topics.length,4);assert.equal(calls(),6);
  const duplicate=await runtime.stageCourseCorpus({...f,documents:[await document('Nouns name things.','renamed.md')]});assert.equal(duplicate.generationId,first.generationId);assert.equal(duplicate.status,'ready');assert.equal(duplicate.duplicate,true);assert.equal((await runtime.readActiveCourseGeneration(f)).generationId,third.generationId);assert.equal(calls(),6);
  assert.equal((await runtime.getCourseTopic({...f,generationId:first.generationId,id:'topic-1'})).body,'这是材料支持的课程主题。');
  const oldReady=await readFile(path.join(f.root,'generations',first.generationId,'ready.json'));
  await runtime.activateCourseCorpus({...f,generationId:first.generationId,consent:consent(first)});assert.equal(calls(),6);assert.deepEqual(await readFile(path.join(f.root,'generations',first.generationId,'ready.json')),oldReady);
});

test('QA pins verified evidence, projects latest input, fails busy and rejects oversized wire before spend',async t=>{
  assert.equal(typeof runtime.selectCourseEvidence,'function');const f=await fixture(t);let release,entered;const started=new Promise(resolve=>entered=resolve);let answerMode=false;
  let qa=0;
  const calls=provider(t,async input=>{if(!answerMode)return topic(input);qa++;if(qa===1){entered();await new Promise(resolve=>release=resolve);assert.match(input.messages[0].content,/那第二份呢？/u);return {kind:'grounded-selection',resolvedQuestion:'那第二份呢？',selections:docs.map(d=>({sourceDigest:d.sourceDigest,fromLine:1,toLine:1}))};}return {answer:'两份资料描述不同词类。'};});
  const docs=[await document(),await document('Adjectives describe nouns.','adjective.md')];const staged=await runtime.stageCourseCorpus({...f,documents:docs});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  const evidence=await runtime.selectCourseEvidence({...f,generationId:staged.generationId,messages:[{role:'user',content:'词类区别？'}]});assert.equal(evidence.coverage,'complete');assert.equal(evidence.documents.length,2);
  const oversized=await request(f.root,'x'.repeat(48*1024));await assert.rejects(runtime.runCourseGatewayRequest({...f,request:oversized}),{code:'COURSE_WIKI_REQUEST_INVALID'});assert.equal(calls(),2);
  answerMode=true;const pending=runtime.runCourseGatewayRequest({...f,request:await request(f.root,'那第二份呢？')});await started;
  await assert.rejects(runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)}),{code:'COURSE_WIKI_OPERATION_BUSY'});release();const answer=await pending;
  assert.equal(answer.generationId,staged.generationId);assert.deepEqual(answer.sourceDigests.sort(),docs.map(d=>d.sourceDigest).sort());assert.equal(answer.corpusDigest,staged.corpusDigest);
  await f.control({forge:true});await assert.rejects(runtime.selectCourseEvidence({...f,generationId:staged.generationId,messages:[{role:'user',content:'词类？'}]}),{code:'COURSE_WIKI_NATIVE_MAPPING_INVALID'});
});

test('large corpus uses bounded retrieval with referents and empty hits remain retrieved coverage',async t=>{
  assert.equal(typeof runtime.selectCourseEvidence,'function');const f=await fixture(t);let querying=false;const calls=provider(t,input=>{if(!querying)return topic(input);const text=input.messages.map(m=>m.content).join('\n');assert.ok(text.includes('Earlier nouns'));assert.ok(text.includes('那么它呢'));return {query:'nouns'};});
  const docs=await Promise.all([0,1,2].map(i=>document(`Lesson ${i}.\n`+'word '.repeat(1300),`lesson-${i}.txt`)));const staged=await runtime.stageCourseCorpus({...f,documents:docs});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  await f.control({empty:true});querying=true;const evidence=await runtime.selectCourseEvidence({...f,generationId:staged.generationId,messages:[{role:'user',content:'Earlier nouns'},{role:'assistant',content:'先前讨论名词。'},{role:'user',content:'那么它呢'}]});assert.equal(evidence.coverage,'retrieved');assert.deepEqual(evidence.documents,[]);assert.deepEqual(evidence.sourceDigests,[]);assert.equal(calls(),4);
  await f.control({});const found=await runtime.selectCourseEvidence({...f,generationId:staged.generationId,messages:[{role:'user',content:'Earlier nouns'},{role:'user',content:'那么它呢'}]});assert.equal(found.coverage,'retrieved');assert.equal(found.documents.length,3);assert.deepEqual(found.sourceDigests.sort(),docs.map(d=>d.sourceDigest).sort());assert.equal(calls(),5);
  await f.control({unknown:true});await assert.rejects(runtime.selectCourseEvidence({...f,generationId:staged.generationId,messages:[{role:'user',content:'Earlier nouns，那么它呢'}]}),{code:'COURSE_WIKI_NATIVE_MAPPING_INVALID'});assert.equal(calls(),6);
});

test('failed ingest, compile, lint and unrepresentable sources cannot replace the complete active pointer',async t=>{
  assert.equal(typeof runtime.stageCourseCorpus,'function');const f=await fixture(t),calls=provider(t,topic);
  const first=await runtime.stageCourseCorpus({...f,documents:[await document()]});await runtime.activateCourseCorpus({...f,generationId:first.generationId,consent:consent(first)});const pointer=await readFile(path.join(f.root,'active-generation.json'));
  for(const fail of ['ingest','compile','lint']){await f.control({fail});await assert.rejects(runtime.stageCourseCorpus({...f,documents:[await document(`New ${fail} lesson.`)]}));assert.deepEqual(await readFile(path.join(f.root,'active-generation.json')),pointer);}
  await f.control({});const huge=await runtime.stageCourseCorpus({...f,documents:[await document('Small valid first.','small.txt'),await document('word '.repeat(6000))]});
  await assert.rejects(runtime.activateCourseCorpus({...f,generationId:huge.generationId,consent:consent(huge)}),{code:'COURSE_WIKI_EVIDENCE_TOO_LARGE'});assert.equal(calls(),1);assert.deepEqual(await readFile(path.join(f.root,'active-generation.json')),pointer);
  const active=await runtime.readActiveCourseGeneration(f);await writeFile(path.join(active.directory,'workspace-view','WIKI.md'),'forged');await assert.rejects(runtime.readActiveCourseGeneration(f));
});

test('changed campaign, stale consent and rebinding cannot gain data or spending authority',async t=>{
  assert.equal(typeof runtime.bindCourseProjectBudget,'function');const f=await fixture(t),calls=provider(t,topic);
  const staged=await runtime.stageCourseCorpus({...f,documents:[await document()]});
  await assert.rejects(runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged),liveAuthorization:{...f.liveAuthorization,campaign:runtime.COURSE_WIKI_INTERACTIVE_CAMPAIGN}}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
  await assert.rejects(runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:{...consent(staged),corpusDigest:'sha256:'+'0'.repeat(64)}}),{code:'COURSE_WIKI_CONSENT_REJECTED'});
  await assert.rejects(runtime.bindCourseProjectBudget({...f,...f.projectBudget,budgetReference:{...f.projectBudget.budgetReference,policyDigest:'sha256:'+'0'.repeat(64)}}));assert.equal(calls(),0);
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  await assert.rejects(runtime.selectCourseEvidence({...f,generationId:staged.generationId,messages:[{role:'user',content:'Explain'}],liveAuthorization:{...f.liveAuthorization,root:'/another-root'}}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});assert.equal(calls(),1);
});

async function inventory(directory){const entries=[];async function visit(dir){for(const entry of await readdir(dir,{withFileTypes:true})){const file=path.join(dir,entry.name);if(entry.isDirectory())await visit(file);else entries.push([path.relative(directory,file),createHash('sha256').update(await readFile(file)).digest('hex')]);}}await visit(directory);return entries.sort((a,b)=>a[0].localeCompare(b[0]));}

test('real native selected corpus generates and retrieves without mutating the ready generation',async t=>{
  const f=await fixture(t,{realNative:true}),calls=provider(t,input=>input.messages[0].content.includes('Convert the latest user question')?{query:'nouns'}:topic(input));const docs=[await document('Nouns name persons, places and things.\n'+'word '.repeat(1500)),await document('Nouns can be proper or common.\n'+'word '.repeat(1500),'other.md')];const staged=await runtime.stageCourseCorpus({...f,documents:docs});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  const active=await runtime.readActiveCourseGeneration(f),before=await inventory(active.directory);
  const evidence=await runtime.selectCourseEvidence({...f,generationId:active.generationId,messages:[{role:'user',content:'名词是什么？'}]});assert.equal(evidence.coverage,'retrieved');assert.deepEqual(evidence.sourceDigests.sort(),docs.map(d=>d.sourceDigest).sort());assert.equal(calls(),3);
  const after=await inventory(active.directory);assert.equal(after.length,before.length);assert.deepEqual(after.filter((entry,i)=>JSON.stringify(entry)!==JSON.stringify(before[i])),[]);assert.deepEqual(await readdir(path.join(f.root,'turns')),[]);
});

test('selected authorization cannot route a model call through the legacy per-root budget',async t=>{
  const f=await fixture(t);for(const operation of [runtime.generateCourseWiki,runtime.runCourseTurn,runtime.runCourseWorkspaceTurn])await assert.rejects(operation({...f,message:'课程'}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
});

test('final selected-stage wire is rejected before a provider reservation',async t=>{
  const f=await fixture(t),calls=provider(t,topic),staged=await runtime.stageCourseCorpus({...f,documents:[await document('Word '.repeat(1800))]});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  const input=await request(f.root,'x'.repeat(39*1024));assert.ok(Buffer.byteLength(JSON.stringify(input))<48*1024);
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:input}),{code:'COURSE_WIKI_EVIDENCE_TOO_LARGE'});assert.equal(calls(),1);assert.equal((await f.summary()).consumedRequests,1);
});

test('failed generation and restart with incomplete consent retain old active bytes without retrying',async t=>{
  const f=await fixture(t);let reject=false;const calls=provider(t,input=>reject?{topics:[]}:topic(input));const first=await runtime.stageCourseCorpus({...f,documents:[await document()]});await runtime.activateCourseCorpus({...f,generationId:first.generationId,consent:consent(first)});const pointer=await readFile(path.join(f.root,'active-generation.json'));
  reject=true;const failed=await runtime.stageCourseCorpus({...f,documents:[await document('Changed lesson.')]});await assert.rejects(runtime.activateCourseCorpus({...f,generationId:failed.generationId,consent:consent(failed)}),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});await assert.rejects(runtime.activateCourseCorpus({...f,generationId:failed.generationId,consent:consent(failed)}),{code:'COURSE_WIKI_GENERATION_INCOMPLETE'});assert.equal(calls(),2);assert.equal((await f.summary()).consumedRequests,2);
  const pending=await runtime.stageCourseCorpus({...f,documents:[await document('Interrupted lesson.')]});await writeFile(path.join(f.root,'generations',pending.generationId,'consent.json'),JSON.stringify(consent(pending)),{flag:'wx'});
  const restarted=await import('../src/course-wiki-openclaw.js?restart-check');const state=await restarted.getCourseCorpus(f);assert.equal(state.active.generationId,first.generationId);assert.equal(state.pending.find(p=>p.generationId===pending.generationId).status,'incomplete');assert.deepEqual(await readFile(path.join(f.root,'active-generation.json')),pointer);
});

test('project preparation refuses hidden root overrides before creating a runtime',async t=>{
  const f=await fixture(t),root=path.join(f.base,'unexpected-runtime');
  await assert.rejects(runtime.prepareCourseWorkspace({root,executable:'/usr/bin/false',projectBudget:{...f.projectBudget,root:f.root}}),{code:'COURSE_WIKI_BUDGET_REJECTED'});
  assert.equal((await readdir(f.base)).includes('unexpected-runtime'),false);
});

test('old conversation sources cannot authorize citations after a generation switch',async t=>{
  const f=await fixture(t),old=await document('Nouns name things.'),current=await document('Verbs express action.','new.txt');let answering=false,chosen=old,stage='select';
  const calls=provider(t,input=>{if(!answering)return topic(input);if(stage==='select'){stage='answer';return {kind:'grounded-selection',resolvedQuestion:'当前资料是什么？',selections:[{sourceDigest:chosen.sourceDigest,fromLine:1,toLine:1}]};}stage='select';return {answer:'这是当前资料的回答。'};});
  for(const doc of [old,current]){const staged=await runtime.stageCourseCorpus({...f,documents:[doc]});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});}
  answering=true;const input=await request(f.root,'当前资料是什么？');input.messages.splice(1,0,{role:'assistant',content:`SOURCE ${old.sourceDigest}\n1|${old.text}`});
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:input}),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});assert.equal(calls(),3);
  chosen=current;stage='select';const answer=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'再看当前资料。')});assert.deepEqual(answer.sourceDigests,[current.sourceDigest]);assert.equal(calls(),5);assert.equal((await f.summary()).consumedRequests,5);
});

test('large-corpus successful and failed translation replays cannot spend another reservation',async t=>{
  const f=await fixture(t);let phase='generation',rejectTranslation=false;
  const calls=provider(t,input=>{if(phase==='generation')return topic(input);if(rejectTranslation)throw new Error('synthetic route failure');return {kind:'conversation',answer:'你好，可以讨论当前资料。'};});
  const staged=await runtime.stageCourseCorpus({...f,documents:await Promise.all([0,1,2].map(i=>document(`Lesson ${i}.\n`+'word '.repeat(1300),`source-${i}.txt`)))});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});phase='qa';
  const input=await request(f.root,'你好');await runtime.runCourseGatewayRequest({...f,request:input});assert.equal(calls(),4);assert.equal((await f.summary()).consumedRequests,4);
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:input}),{code:'COURSE_WIKI_DUPLICATE_REQUEST'});assert.equal(calls(),4);assert.equal((await f.summary()).consumedRequests,4);
  const equivalent=Object.fromEntries(Object.entries({...input,max_tokens:undefined,max_completion_tokens:2048,n:1,stream_options:{include_usage:true},messages:input.messages.map(m=>({content:[{type:'text',text:m.content}],role:m.role}))}).reverse());
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:equivalent}),{code:'COURSE_WIKI_DUPLICATE_REQUEST'});assert.equal(calls(),4);assert.equal((await f.summary()).consumedRequests,4);
  rejectTranslation=true;const failure=await request(f.root,'这次路由失败');await assert.rejects(runtime.runCourseGatewayRequest({...f,request:failure}),{code:'COURSE_WIKI_UPSTREAM_NETWORK'});assert.equal(calls(),5);assert.equal((await f.summary()).consumedRequests,5);
  const restarted=await import('../src/course-wiki-openclaw.js?replay-restart');await assert.rejects(restarted.runCourseGatewayRequest({...f,request:failure}),{code:'COURSE_WIKI_DUPLICATE_REQUEST'});assert.equal(calls(),5);assert.equal((await f.summary()).consumedRequests,5);
  phase='generation';rejectTranslation=false;const changed=await runtime.stageCourseCorpus({...f,documents:[await document('A new selected lesson.')]});await runtime.activateCourseCorpus({...f,generationId:changed.generationId,consent:consent(changed)});phase='qa';
  const next=await runtime.runCourseGatewayRequest({...f,request:input});assert.equal(next.generationId,changed.generationId);assert.equal(calls(),7);assert.equal((await f.summary()).consumedRequests,7);
});

test('invalid large-corpus native options are rejected before translation or reservation',async t=>{
  const f=await fixture(t);let phase='generation';const calls=provider(t,input=>phase==='generation'?topic(input):{query:'nouns'});
  const staged=await runtime.stageCourseCorpus({...f,documents:await Promise.all([0,1,2].map(i=>document(`Lesson ${i}.\n`+'word '.repeat(1300),`source-${i}.txt`)))});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});phase='qa';
  const base=await request(f.root,'哪些是名词？');
  const invalid=[{...base,max_tokens:9999},{...base,max_tokens:undefined,max_completion_tokens:9999},{...base,max_completion_tokens:2048},{...base,model:'unapproved-model'},{...base,extra:true},{...base,messages:base.messages.map(m=>({...m,extra:true}))},{...base,n:2},{...base,thinking:{type:'enabled'}},{...base,temperature:Infinity},{...base,messages:[...base.messages,...Array.from({length:31},()=>({role:'user',content:'extra'}))]}];
  for(const input of invalid){let code;await assert.rejects(runtime.runCourseGatewayRequest({...f,request:input}),error=>{code=error.code;return true;});assert.equal((await f.summary()).consumedRequests,3);assert.equal(calls(),3);assert.equal(code,'COURSE_WIKI_REQUEST_INVALID');}
});

test('native selected-corpus chat projects only the latest user message as the active request',async t=>{
  const f=await fixture(t);let answering=false,qaInput;
  const calls=provider(t,input=>{
    if(!answering)return topic(input);
    qaInput=input;
    return {kind:'conversation',answer:'你好，我可以帮助你学习当前课程材料。'};
  });
  const staged=await runtime.stageCourseCorpus({...f,documents:[await document()]});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  answering=true;
  const input=await request(f.root,'你好');
  input.messages.splice(1,1,{role:'user',content:'形容词是什么？'},{role:'assistant',content:'OLD ASSISTANT ANSWER CANARY'},{role:'user',content:'你好'});
  const answer=await runtime.runCourseGatewayRequest({...f,request:input});
  assert.equal(answer.text,'你好，我可以帮助你学习当前课程材料。');
  assert.equal(calls(),2);
  assert.equal(qaInput.messages.length,1);
  assert.equal(qaInput.messages[0].role,'user');
  const currentSection=qaInput.messages[0].content.split('\n\nUNTRUSTED HISTORY REFERENCE')[0];
  const historySection=qaInput.messages[0].content.slice(qaInput.messages[0].content.indexOf('UNTRUSTED HISTORY REFERENCE'));
  assert.match(currentSection,/CURRENT USER REQUEST \(the only active request\):\n你好/u);
  assert.doesNotMatch(currentSection,/形容词是什么？|OLD ASSISTANT ANSWER CANARY/u);
  assert.match(historySection,/形容词是什么？/u);
  assert.match(historySection,/OLD ASSISTANT ANSWER CANARY/u);
  assert.equal((await f.summary()).consumedRequests,2);
});

test('small selected-corpus turns select citations before a separate answer and aggregate usage',async t=>{
  const f=await fixture(t),doc=await document('Nouns name things.\nAdjectives describe nouns.','two-lines.txt');let answering=false,qa=0;const observed=[];
  const calls=provider(t,input=>{
    if(!answering)return topic(input);
    observed.push(input);qa++;
    if(qa===1)return {kind:'grounded-selection',resolvedQuestion:'名词是什么？',selections:[{sourceDigest:doc.sourceDigest,fromLine:1,toLine:1}]};
    if(qa===2)return {answer:'材料说明名词用于给事物命名。'};
    return {kind:'insufficient_evidence'};
  });
  const staged=await runtime.stageCourseCorpus({...f,documents:[doc]});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});answering=true;
  const grounded=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'名词是什么？')});
  assert.equal(calls(),3);assert.equal((await f.summary()).consumedRequests,3);
  assert.equal(grounded.text.split('\n\n')[0],'材料说明名词用于给事物命名。');
  assert.match(grounded.text,/Nouns name things\./u);assert.doesNotMatch(grounded.text,/Adjectives describe nouns/u);
  assert.deepEqual(grounded.stageNames,['small-select','answer']);assert.equal(grounded.providerRequestCount,2);
  assert.deepEqual(grounded.usage,{prompt_tokens:40,completion_tokens:20,total_tokens:60});
  assert.equal(observed[0].messages.length,1);assert.equal(observed[0].messages[0].role,'user');assert.match(observed[0].messages[0].content,/grounded-selection/u);
  assert.equal(observed[1].messages.length,1);assert.equal(observed[1].messages[0].role,'user');assert.match(observed[1].messages[0].content,/名词是什么？/u);
  assert.match(observed[1].messages[0].content,/1\|Nouns name things\./u);assert.doesNotMatch(observed[1].messages[0].content,/Adjectives describe nouns|Earlier hidden history/u);
  const insufficient=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'材料里有没有火星生命信息？')});
  assert.match(insufficient.text,/证据不足/u);assert.equal(insufficient.stageNames.length,1);assert.equal(insufficient.providerRequestCount,1);
  assert.equal(insufficient.text.includes('kind'),false);assert.equal(calls(),4);assert.equal((await f.summary()).consumedRequests,4);
});

test('large selected-corpus turns route, retrieve and select before answering, while misses stop after routing',async t=>{
  const f=await fixture(t),documents=await Promise.all([0,1,2].map(index=>document(`Lesson ${index}.\n`+'word '.repeat(1100),`large-${index}.txt`)));
  let answering=false,mode='conversation',qa=0;const observed=[];
  const calls=provider(t,input=>{
    if(!answering)return topic(input);
    observed.push(input);qa++;
    if(mode==='conversation')return {kind:'conversation',answer:'你好，我可以帮助你学习当前课程材料。'};
    if(mode==='miss')return {kind:'search',query:'missing'};
    if(qa%3===1)return {kind:'search',query:'lesson'};
    if(qa%3===2)return {kind:'grounded-selection',resolvedQuestion:'Lesson 0 讲了什么？',selections:[{sourceDigest:documents[0].sourceDigest,fromLine:1,toLine:1}]};
    return {answer:'选中的材料说明这是第零课。'};
  });
  const staged=await runtime.stageCourseCorpus({...f,documents});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});answering=true;
  mode='conversation';const greeting=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'你好')});
  assert.equal(greeting.text,'你好，我可以帮助你学习当前课程材料。');assert.deepEqual(greeting.stageNames,['route']);assert.equal(greeting.providerRequestCount,1);
  mode='grounded';qa=0;const grounded=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'Lesson 0 讲了什么？')});
  assert.deepEqual(grounded.stageNames,['route','retrieved-select','answer']);assert.equal(grounded.providerRequestCount,3);
  assert.deepEqual(grounded.sourceDigests,[documents[0].sourceDigest,documents[1].sourceDigest,documents[2].sourceDigest]);
  assert.match(grounded.text,/选中的材料说明这是第零课/u);assert.match(grounded.text,/Lesson 0\./u);
  assert.deepEqual(grounded.usage,{prompt_tokens:60,completion_tokens:30,total_tokens:90});
  assert.equal(observed.at(-2).messages.length,1);assert.equal(observed.at(-2).messages[0].role,'user');
  assert.equal(observed.at(-1).messages.length,1);assert.equal(observed.at(-1).messages[0].role,'user');
  assert.match(observed.at(-1).messages[0].content,/Lesson 0 讲了什么？/u);assert.doesNotMatch(observed.at(-1).messages[0].content,/Lesson 1\.|Lesson 2\./u);
  await f.control({empty:true});mode='miss';qa=0;const missed=await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'没有的内容')});
  assert.match(missed.text,/这不代表整个资料库都没有相关内容/u);assert.deepEqual(missed.stageNames,['route']);assert.equal(missed.providerRequestCount,1);
  assert.equal(calls(),3+1+3+1);assert.equal((await f.summary()).consumedRequests,3+1+3+1);
});

test('selected-corpus balance preflight covers the worst-case route before reserving',async t=>{
  const f=await fixture(t),calls=provider(t,topic),staged=await runtime.stageCourseCorpus({...f,documents:[await document()]});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  const budgetDirectory=path.join(f.projectBudget.budgetRoot,'budget');
  for(let index=2;index<=305;index++)await writeFile(path.join(budgetDirectory,`slot-${String(index).padStart(3,'0')}`),'reserved:31\n',{flag:'wx',mode:0o600});
  const before=await f.summary();assert.equal(before.remainingRequests,1);assert.ok(before.remainingFen<62);
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:await request(f.root,'你好')}),{code:'COURSE_WIKI_ALLOWANCE_EXHAUSTED'});
  assert.equal(calls(),1);assert.equal((await f.summary()).consumedRequests,305);
  assert.equal((await readdir(path.join(f.root,'gateway/attempts'))).length,0);
});

test('large-corpus balance preflight reserves no route when only two of three calls remain',async t=>{
  const f=await fixture(t),docs=await Promise.all([0,1,2].map(index=>document(`Lesson ${index}.\n`+'word '.repeat(1100),`preflight-${index}.txt`)));
  const calls=provider(t,topic),staged=await runtime.stageCourseCorpus({...f,documents:docs});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  const budgetDirectory=path.join(f.projectBudget.budgetRoot,'budget');let summary=await f.summary();
  let slot=(await readdir(budgetDirectory)).filter(name=>name.startsWith('slot-')).length+1;
  while(summary.remainingRequests>2){await writeFile(path.join(budgetDirectory,`slot-${String(slot++).padStart(3,'0')}`),'reserved:31\n',{flag:'wx',mode:0o600});summary=await f.summary();}
  assert.equal(summary.remainingRequests,2);
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:await request(f.root,'你好')}),{code:'COURSE_WIKI_ALLOWANCE_EXHAUSTED'});
  assert.equal(calls(),3);assert.equal((await f.summary()).consumedRequests,summary.consumedRequests);
  assert.equal((await readdir(path.join(f.root,'gateway/attempts'))).length,0);
});

test('selected-corpus stage metadata stays request-local across a concurrent shared-budget reservation',async t=>{
  let answering=false,stageCalls=0,releaseStage,markStageStarted;
  const stageHeld=new Promise(resolve=>{releaseStage=resolve;}),stageStarted=new Promise(resolve=>{markStageStarted=resolve;});
  const calls=provider(t,async input=>{
    if(!answering)return topic(input);
    if(++stageCalls===1){markStageStarted();await stageHeld;return {kind:'conversation',answer:'我可以帮助你学习当前课程材料。'};}
    return {kind:'conversation',answer:'独立预算请求已完成。'};
  });
  const f=await fixture(t),staged=await runtime.stageCourseCorpus({...f,documents:[await document()]});
  await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});
  answering=true;
  const turn=runtime.runCourseGatewayRequest({...f,request:await request(f.root,'你好')});
  await stageStarted;
  const unrelated=await startCourseBudget({root:f.projectBudget.budgetRoot,budgetReference:f.projectBudget.budgetReference,apiKey:f.apiKey});
  try{
    const response=await fetch(unrelated.baseUrl+'/chat/completions',{method:'POST',headers:{authorization:`Bearer ${unrelated.token}`,'content-type':'application/json'},body:JSON.stringify({model:'deepseek-v4-flash',messages:[{role:'user',content:'independent reservation'}],max_tokens:2048,n:1,thinking:{type:'disabled'},stream:false})});
    assert.equal(response.status,200);
  }finally{await unrelated.close();releaseStage();}
  const result=await turn;
  assert.equal(calls(),3);
  assert.deepEqual(result.stageNames,['small-select']);assert.equal(result.providerRequestCount,1);
  assert.equal((await f.summary()).consumedRequests,3);
});

test('selected-corpus native search stops at the shared deadline after a near-deadline route',async t=>{
  const f=await fixture(t),documents=await Promise.all([0,1,2].map(index=>document(`Lesson ${index}.\n`+'word '.repeat(1100),`deadline-${index}.txt`)));
  let answering=false,routeCalls=0,fakeNow=Date.now();const delays=[];const originalTimeout=AbortSignal.timeout;
  const calls=provider(t,input=>{if(!answering)return topic(input);routeCalls++;fakeNow+=119_900;return {kind:'search',query:'lesson'};});
  const staged=await runtime.stageCourseCorpus({...f,documents});await runtime.activateCourseCorpus({...f,generationId:staged.generationId,consent:consent(staged)});answering=true;
  await f.control({delaySearchMs:2000});t.mock.method(Date,'now',()=>fakeNow);
  t.mock.method(AbortSignal,'timeout',milliseconds=>{delays.push(milliseconds);assert.ok(Number.isInteger(milliseconds)&&milliseconds>0);return originalTimeout(milliseconds);});
  const startedAt=performance.now();let failure;
  try{await runtime.runCourseGatewayRequest({...f,request:await request(f.root,'Lesson 0 内容')});}catch(error){failure=error;}
  assert.equal(await readFile(path.join(f.base,'search-started'),'utf8'),'started');
  const searchFinished=await readFile(path.join(f.base,'search-finished'),'utf8').catch(error=>error.code==='ENOENT'?null:Promise.reject(error));
  assert.equal(searchFinished,null,'the native search must be killed before its delayed completion');
  assert.ok(performance.now()-startedAt<1500);
  assert.equal(failure?.code,'COURSE_WIKI_NATIVE_TIMEOUT');
  assert.equal(routeCalls,1);assert.equal(calls(),4);assert.deepEqual(delays,[95_000]);assert.equal((await f.summary()).consumedRequests,4);
  assert.deepEqual(failure.courseWikiStageNames,['route']);assert.equal(failure.courseWikiProviderRequestCount,1);
  await assert.rejects(runtime.runCourseGatewayRequest({...f,request:await request(f.root,'Lesson 0 内容')}),{code:'COURSE_WIKI_DUPLICATE_REQUEST'});
  assert.equal(routeCalls,1);assert.equal(calls(),4);
});
