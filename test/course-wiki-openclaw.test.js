import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, rm, symlink, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {EventEmitter} from 'node:events';
import * as runtime from '../src/course-wiki-openclaw.js';
import { normalizeDocument } from '../src/course-wiki-documents.js';
import {initializeCourseBudget,courseBudgetSummary} from '../src/course-wiki-budget.js';
const executable='/Users/alexzhu/.local/bin/openclaw';
async function temp(t){const parent=await realpath(await mkdtemp(path.join(os.tmpdir(),'course-native-')));t.after(()=>rm(parent,{recursive:true,force:true,maxRetries:3,retryDelay:100}));return parent;}

test('timed-out native child settles after exit even when inherited pipes never close',async()=>{
  assert.equal(typeof runtime.settleCourseNativeChild,'function');
  const child=new EventEmitter();child.stdout=new EventEmitter();child.stderr=new EventEmitter();child.pid=12345;
  let stops=0;const started=Date.now();
  const pending=runtime.settleCourseNativeChild(child,{timeout:10,postKillTimeout:25,stop:()=>{stops++;child.emit('exit',null,'SIGKILL');}});
  await assert.rejects(pending,{code:'COURSE_WIKI_NATIVE_TIMEOUT'});
  assert.equal(stops,1);assert.ok(Date.now()-started<500);
  child.emit('close',0,null);
});

test('the native agent loads persistent workspace context from a plain question and rejects altered bootstrap files before spending',async t=>{
  assert.equal(typeof runtime.provisionCourseAgentWorkspace,'function');
  const root=path.join(await temp(t),'course');await runtime.prepareCourseWorkspace({root,executable,campaign:runtime.COURSE_WIKI_INTERACTIVE_CAMPAIGN});
  const documents=[];for(const name of ['01-nouns.txt','02-adjectives.txt','03-sentence-analysis.txt'])documents.push(await normalizeDocument({name,bytes:await readFile(new URL('../docs/poc/course-wiki/sample-materials/'+name,import.meta.url))}));
  await runtime.importCourseDocuments({root,documents});
  const liveAuthorization={authorized:true,campaign:runtime.COURSE_WIKI_INTERACTIVE_CAMPAIGN,root};
  const provisioned=await runtime.provisionCourseAgentWorkspace({root,liveAuthorization});
  assert.equal(provisioned.workspace,path.join(root,'workspace'));assert.equal((await courseBudgetSummary({root})).consumedRequests,0);
  const before=await readFile(path.join(root,'workspace','MEMORY.md'),'utf8');
  const original=globalThis.fetch;let requests=0,observed;process.env.DEEPSEEK_API_KEY='synthetic-only';t.after(()=>{delete process.env.DEEPSEEK_API_KEY;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https:'))return original(url,options);
    requests++;observed=JSON.parse(options.body);
    const answer={kind:'grounded',answer:'形容词是用来描述或限定名词等表达的词。',citations:[{sourceDigest:'sha256:28e754b8d60c1ccb6fb2097760ef7b8418904de5a843df6a1c8084a23309edd1',fromLine:56,toLine:57}]};
    return new Response(`data: ${JSON.stringify({id:'workspace',object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(answer)},finish_reason:'stop'}],usage:{prompt_tokens:500,completion_tokens:100,total_tokens:600}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  });
  const answer=await runtime.runCourseWorkspaceTurn({root,message:'形容词是什么呢？',liveAuthorization});
  assert.equal(answer.kind,'grounded');assert.equal(Object.hasOwn(answer,'missingEvidence'),false);assert.match(answer.citations[0].quote,/An adjective is a word/);assert.equal(requests,1);
  const user=observed.messages.filter(m=>m.role==='user');assert.equal(user.length,1);
  // 2026.9.4 appends native runtime metadata, not teaching text, to the user envelope.
  const envelope=user[0].content.split('\n\n');assert.ok(envelope.length<=2);
  assert.match(envelope[0],/^(?:\[[^\]\n]{1,80}\] )?形容词是什么呢？$/u);
  if(envelope.length===2){assert.ok(envelope[1].length<2048);assert.match(envelope[1],/^Runtime: agent=course-wiki \| [^\n]+$/u);assert.match(envelope[1],/model=deepseek\/deepseek-v4-flash/);}
  const system=observed.messages.filter(m=>m.role==='system').map(m=>m.content).join('\n');
  assert.ok(system.includes('Course Wiki'));assert.ok(system.includes('An adjective is a word joined to a noun'));assert.ok(system.includes('SOURCE sha256:28e754b8d60c1ccb6fb2097760ef7b8418904de5a843df6a1c8084a23309edd1'));assert.equal(observed.tools,undefined);
  assert.equal(await readFile(path.join(root,'workspace','MEMORY.md'),'utf8'),before);
  await runtime.provisionCourseAgentWorkspace({root,liveAuthorization});assert.equal((await courseBudgetSummary({root})).consumedRequests,1);
  await assert.rejects(runtime.generateCourseWiki({root,liveAuthorization}),{code:'COURSE_WIKI_WORKSPACE_FROZEN'});
  await assert.rejects(runtime.importCourseDocuments({root,documents}),{code:'COURSE_WIKI_WORKSPACE_FROZEN'});
  assert.equal(requests,1,'a published workspace rejects mutations before any model call');
  await writeFile(path.join(root,'workspace','USER.md'),'Unapproved workspace context');
  await assert.rejects(runtime.runCourseWorkspaceTurn({root,message:'形容词是什么呢？',liveAuthorization}),{code:'COURSE_WIKI_WORKSPACE_INVALID'});
  assert.equal(requests,1);assert.equal((await courseBudgetSummary({root})).consumedRequests,1);
  const pointer=JSON.parse(await readFile(path.join(root,'selected.json'),'utf8'));const manifestPath=path.join(root,'corpora',pointer.id,'manifest.json');
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));manifest.sources[2]=manifest.sources[0];await writeFile(manifestPath,JSON.stringify(manifest));
  await assert.rejects(runtime.provisionCourseAgentWorkspace({root,liveAuthorization}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
});

test('duplicate uploaded names cannot shadow workspace instructions or collapse approved originals',async t=>{
  const root=path.join(await temp(t),'course');await runtime.prepareCourseWorkspace({root,executable,campaign:runtime.COURSE_WIKI_INTERACTIVE_CAMPAIGN});
  const documents=[];for(const name of ['01-nouns.txt','02-adjectives.txt','03-sentence-analysis.txt'])documents.push(await normalizeDocument({name:'AGENTS.md',bytes:await readFile(new URL('../docs/poc/course-wiki/sample-materials/'+name,import.meta.url))}));
  await runtime.importCourseDocuments({root,documents});const liveAuthorization={authorized:true,campaign:runtime.COURSE_WIKI_INTERACTIVE_CAMPAIGN,root};
  await runtime.provisionCourseAgentWorkspace({root,liveAuthorization});
  for(let i=0;i<3;i++)assert.deepEqual(await readFile(path.join(root,'workspace',`source-${i+1}.md`)),documents[i].originalBytes);
  assert.equal((await courseBudgetSummary({root})).consumedRequests,0);
});

test('a misleading native search hit cannot exclude the adjective definition from this fixed corpus',async t=>{
  const root=path.join(await temp(t),'course');await runtime.prepareCourseWorkspace({root,executable,campaign:'course-wiki-interactive-2026-09-15'});
  const documents=[];for(const name of ['01-nouns.txt','02-adjectives.txt','03-sentence-analysis.txt'])documents.push(await normalizeDocument({name,bytes:await readFile(new URL('../docs/poc/course-wiki/sample-materials/'+name,import.meta.url))}));
  await runtime.importCourseDocuments({root,documents});
  const original=globalThis.fetch;let count=0,answerPrompt='';process.env.DEEPSEEK_API_KEY='synthetic-test-only';t.after(()=>{delete process.env.DEEPSEEK_API_KEY;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    if(!String(url).startsWith('https:'))return original(url,options);
    count++;if(count>=3)throw new Error('private upstream failure');const body=JSON.parse(options.body);
    if(count===2)answerPrompt=body.messages.map(m=>m.content).join('\n');
    const answer=count===1?{query:'ivy'}:{kind:'insufficient_evidence',answer:'材料中没有相关说明。',citations:[]};
    return new Response(`data: ${JSON.stringify({id:'coverage-'+count,object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(answer)},finish_reason:'stop'}],usage:{prompt_tokens:500,completion_tokens:100,total_tokens:600}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  });
  await runtime.runCourseTurn({root,message:'形容词是什么呢？',liveAuthorization:{authorized:true,campaign:'course-wiki-interactive-2026-09-15',root}});
  assert.equal(count,2);assert.ok(answerPrompt.includes('SOURCE sha256:28e754b8d60c1ccb6fb2097760ef7b8418904de5a843df6a1c8084a23309edd1'),'adjective source must survive misleading search');
  assert.ok(answerPrompt.includes('An adjective is a word'));
  await assert.rejects(runtime.runCourseTurn({root,message:'形容词是什么呢？',liveAuthorization:{authorized:true,campaign:'course-wiki-interactive-2026-09-15',root}}),{code:'COURSE_WIKI_UPSTREAM_NETWORK'});
  assert.equal(count,3,'a failed provider request is never automatically retried upstream');
  assert.equal((await courseBudgetSummary({root})).consumedRequests,3,'failed request reservation is retained');
});

test('native startup failures distinguish missing executable from nonzero exit without exposing output',async t=>{
  const parent=await temp(t);
  await assert.rejects(runtime.prepareCourseWorkspace({root:path.join(parent,'missing'),executable:path.join(parent,'absent')}),{code:'COURSE_WIKI_NATIVE_SPAWN_FAILED'});
  await assert.rejects(runtime.prepareCourseWorkspace({root:path.join(parent,'exit'),executable:'/usr/bin/false'}),{code:'COURSE_WIKI_NATIVE_EXIT_FAILED'});
});

test('never overwrites an existing root or follows a root symlink',async t=>{
  const parent=await temp(t);await assert.rejects(runtime.prepareCourseWorkspace({root:parent,executable}));
  await symlink(parent,path.join(parent,'link'));await assert.rejects(runtime.prepareCourseWorkspace({root:path.join(parent,'link'),executable}));
});
test('never invokes a provider without explicit exact campaign authorization',async t=>{
  const parent=await temp(t);await assert.rejects(runtime.runCourseTurn({root:parent,message:'Explain nouns.'}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
});
test('a legacy ledger cannot acquire interactive authority',async t=>{
  const root=await temp(t);await initializeCourseBudget({root});
  const legacy={authorized:true,campaign:'course-wiki-public-2026-09-14',root};
  await assert.rejects(runtime.runCourseTurn({root,message:'名词是什么？',liveAuthorization:legacy}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
  await assert.rejects(runtime.runCourseTurn({root,message:'名词是什么？',liveAuthorization:{...legacy,campaign:'course-wiki-interactive-2026-09-15'}}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
});
test('native isolated registration and ingest preserve originals and expose verified body citations',async t=>{
  const root=path.join(await temp(t),'course');
  const workspace=await runtime.prepareCourseWorkspace({root,executable});assert.equal(workspace.agentId,'course-wiki');
  const a=await normalizeDocument({name:'lesson.md',bytes:Buffer.from('Nouns name objects.\n```\nAdjectives describe objects.\n')});
  const imported=await runtime.importCourseDocuments({root,documents:[a]});assert.equal(imported.sources.length,1);assert.ok(imported.sources[0].nativeId);
  const corpus=await runtime.getCourseCorpus({root});assert.equal(corpus.sources[0].sourceDigest,a.sourceDigest);
  const document=await runtime.getCourseDocument({root,sourceDigest:a.sourceDigest});assert.equal(document.text,a.text);assert.equal(document.originalText,a.originalText);
  const config=JSON.parse(await readFile(workspace.configPath,'utf8'));assert.deepEqual(config.tools.deny,['*']);assert.equal(config.models.providers.deepseek.models[0].id,'deepseek-v4-flash');
  await assert.rejects(runtime.runCourseTurn({root,message:'Explain nouns.',liveAuthorization:{authorized:true}}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});
  const invalid={...a,sourceDigest:'sha256:'+'0'.repeat(64)};await assert.rejects(runtime.importCourseDocuments({root,documents:[invalid]}));
  assert.equal((await runtime.getCourseCorpus({root})).sources[0].sourceDigest,a.sourceDigest);
});

test('closed child environment excludes host secrets, proxies and OpenClaw defaults',()=>{
  process.env.COURSE_TEST_SECRET='not-forwardable';process.env.HTTPS_PROXY='not-forwardable';
  const env=runtime.courseChildEnvironment('/isolated/course','local-only');assert.equal(env.COURSE_TEST_SECRET,undefined);assert.equal(env.HTTPS_PROXY,undefined);assert.equal(env.DEEPSEEK_API_KEY,undefined);assert.equal(env.HOME,'/isolated/course/home');assert.equal(env.COURSE_WIKI_PROXY_TOKEN,'local-only');delete process.env.COURSE_TEST_SECRET;delete process.env.HTTPS_PROXY;
});

test('real native agent with fake upstream generates grounded topics and answers without raw meta leakage',async t=>{
  const root=path.join(await temp(t),'course');await runtime.prepareCourseWorkspace({root,executable,campaign:'course-wiki-interactive-2026-09-15'});
  assert.equal((await courseBudgetSummary({root})).remainingRequests,64);
  const documents=[];for(const name of ['01-nouns.txt','02-adjectives.txt','03-sentence-analysis.txt'])documents.push(await normalizeDocument({name,bytes:await readFile(new URL('../docs/poc/course-wiki/sample-materials/'+name,import.meta.url))}));
  await runtime.importCourseDocuments({root,documents});
  const selections=documents.map(d=>({sourceDigest:d.sourceDigest,fromLine:1,toLine:1}));
  const expectedTopicCitations=[
    [{...selections[0],quote:'NOUNS.'}],
    [{...selections[1],quote:'ADJECTIVES.'}],
    [{...selections[2],quote:'PART II.'}],
  ];
  const answerSelection={sourceDigest:documents[0].sourceDigest,fromLine:1,toLine:4};
  const original=globalThis.fetch;let count=0;process.env.DEEPSEEK_API_KEY='synthetic-test-only';t.after(()=>{delete process.env.DEEPSEEK_API_KEY;});
  t.mock.method(globalThis,'fetch',async(url,options)=>{if(!String(url).startsWith('https:'))return original(url,options);assert.equal(String(url),'https://api.deepseek.com/chat/completions');count++;const body=JSON.parse(options.body);assert.equal(body.model,'deepseek-v4-flash');assert.equal(body.max_tokens,2048);assert.equal(body.tools,undefined);
    let answer;
    if(count===1)answer={topics:documents.map((d,i)=>({title:'主题'+(i+1),body:'这是受引用支持的中文主题。',citations:[selections[i]]}))};
    else if([2,5,7,9].includes(count))answer={query:'nouns adjectives'};
    else if(count===3||count===10)answer={kind:'grounded',answer:'这是基于材料的回答。',citations:[answerSelection]};
    else if(count===4)answer={topics:documents.map((d,i)=>({title:'替换主题'+(i+1),body:'这段内容不得发布。',citations:[{...selections[i],quote:d.lines[0]}]}))};
    else if(count===6)answer={kind:'insufficient_evidence',answer:'材料未提供雅思写作 7 分标准。',citations:[]};
    else answer={kind:'insufficient_evidence',answer:'材料缺失但错误地附加了引用。',citations:[answerSelection]};
    return new Response(`data: ${JSON.stringify({id:'test-'+count,object:'chat.completion.chunk',created:1,model:'deepseek-flash',choices:[{index:0,delta:{role:'assistant',content:JSON.stringify(answer)},finish_reason:'stop'}],usage:{prompt_tokens:500,completion_tokens:100,total_tokens:600}})}\n\ndata: [DONE]\n\n`,{headers:{'content-type':'text/event-stream'}});
  });
  const liveAuthorization={authorized:true,campaign:'course-wiki-interactive-2026-09-15',root};
  await assert.rejects(runtime.generateCourseWiki({root,liveAuthorization:{...liveAuthorization,root:'/another-root'}}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});assert.equal(count,0);
  const generated=await runtime.generateCourseWiki({root,liveAuthorization});assert.equal(generated.topics.length,3);assert.equal(new Set(generated.topics.map(t=>t.nativeId)).size,3);assert.deepEqual(generated.topics.map(topic=>topic.citations),expectedTopicCitations);assert.deepEqual((await runtime.getCourseTopic({root,id:'topic-1'})).citations,expectedTopicCitations[0]);
  const answer=await runtime.runCourseTurn({root,message:'根据材料，专有名词和普通名词的区别是什么？',liveAuthorization});assert.equal(answer.kind,'grounded');assert.equal(answer.answer,'这是基于材料的回答。');assert.deepEqual(answer.citations,[{...answerSelection,quote:'NOUNS.\n\n\n1. In the more simple _state_ of the _Arabs_, the _nation_ is free,'}]);assert.equal(answer.meta,undefined);assert.equal(count,3);
  assert.deepEqual(answer.usage,{prompt_tokens:1000,completion_tokens:200,total_tokens:1200,actualModel:'deepseek-flash',consumedRequests:3,reservedCny:0.93});
  assert.equal((await runtime.getCourseCorpus({root})).budget.consumedRequests,3);
  await assert.rejects(runtime.runCourseTurn({root,message:'Unapproved question',liveAuthorization:{...liveAuthorization,campaign:'course-wiki-public-2026-09-14'}}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});assert.equal(count,3);
  await assert.rejects(runtime.generateCourseWiki({root,liveAuthorization}),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});assert.deepEqual((await runtime.getCourseCorpus({root})).topics,generated.topics);
  const missing=await runtime.runCourseTurn({root,message:'这些资料规定雅思写作 7 分的评分标准是什么？',liveAuthorization});assert.deepEqual(missing,{kind:'insufficient_evidence',answer:'材料未提供雅思写作 7 分标准。',citations:[],usage:{prompt_tokens:1000,completion_tokens:200,total_tokens:1200,actualModel:'deepseek-flash',consumedRequests:6,reservedCny:1.86}});
  await assert.rejects(runtime.runCourseTurn({root,message:'本书把形容词分成哪四类？',liveAuthorization}),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});assert.equal(count,8);
  assert.equal((await runtime.getCourseCorpus({root})).budget.consumedRequests,8);
  const interactive={...liveAuthorization,campaign:'course-wiki-interactive-2026-09-15'};
  const free=await runtime.runCourseTurn({root,message:'名词是什么？',liveAuthorization:interactive});
  assert.equal(free.answer,'这是基于材料的回答。');assert.equal(count,10);
  for(const message of ['', '   ', 'x'.repeat(2001), null])await assert.rejects(runtime.runCourseTurn({root,message,liveAuthorization:interactive}),{code:'COURSE_WIKI_REQUEST_INVALID'});
  for(let i=11;i<=63;i++)await writeFile(path.join(root,'budget',`slot-${i}`),'reserved:31\n',{flag:'wx'});
  await assert.rejects(runtime.runCourseTurn({root,message:'名词是什么？',liveAuthorization:interactive}),{code:'COURSE_WIKI_ALLOWANCE_EXHAUSTED'});assert.equal(count,10);
  const changed=await normalizeDocument({name:'other.txt',bytes:Buffer.from('A different public lesson.')});
  await runtime.importCourseDocuments({root,documents:[changed]});
  await assert.rejects(runtime.runCourseTurn({root,message:'名词是什么？',liveAuthorization:interactive}),{code:'COURSE_WIKI_LIVE_NOT_AUTHORIZED'});assert.equal(count,10);
  assert.deepEqual(await readdir(path.join(root,'turns')),[]);assert.ok(!JSON.stringify(generated).includes('synthetic-test-only'));
});
