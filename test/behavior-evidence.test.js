import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { validateDomainCasesArtifact } from '../src/domain-eval.js';

const module = await import('../src/behavior-evidence.js').catch(error => {
  if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
  throw error;
});
const digest = n => 'sha256:' + String(n).repeat(64);
function executionDigest(value) {
  const sort = x => Array.isArray(x) ? x.map(sort) : x && typeof x === 'object'
    ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])])) : x;
  return 'sha256:' + createHash('sha256').update(JSON.stringify(sort(value))).digest('hex');
}
function fixture() {
  const definition = {caseId:'greeting',caseClass:'conversation',testDigest:digest(1),inputDigest:digest(2),generationId:'generation-1',runtimeDigest:digest(3),executorId:'native-runner',reviewerId:'independent-reviewer',rubricDigest:digest(4),mechanicalCheckIds:['citation','transport'],rubricCheckIds:['focus','usefulness'],maxAgeMs:1000};
  const execution = {caseId:'greeting',caseClass:'conversation',testDigest:digest(1),inputDigest:digest(2),outputDigest:digest(5),evidenceDigest:digest(6),generationId:'generation-1',runtimeDigest:digest(3),executorId:'native-runner',startedAt:1000,completedAt:1100,checks:[{id:'citation',pass:true},{id:'transport',pass:true}]};
  const review = {executionDigest:executionDigest(execution),reviewerId:'independent-reviewer',rubricDigest:digest(4),reviewedAt:1200,checks:[{id:'focus',pass:true},{id:'usefulness',pass:true}]};
  return {caseId:'greeting',caseClass:'conversation',definition,execution,review,now:1500};
}
function build(value) {
  assert.equal(typeof module.buildBehaviorCaseResult, 'function', 'behavior adapter is available');
  return module.buildBehaviorCaseResult(value);
}
function rejected(value) {
  assert.throws(() => build(value), {name:'BehaviorEvidenceError',code:'AGENTMO_BEHAVIOR_EVIDENCE_INVALID'});
}
test('only executed, independently reviewed checks produce an existing passing domain row',async()=>{
  const row=build(fixture());
  assert.equal(row.passed,true);assert.equal(row.score,1);assert.equal(row.threshold,1);
  assert.deepEqual(row.hardFailureIds,[]);
  const cases=JSON.parse(await readFile(new URL('../examples/support-triage.domain-cases.json',import.meta.url)));
  cases.cases=[row];assert.equal(validateDomainCasesArtifact(cases).ok,true);
});
test('unexecuted and unreviewed cases remain valid failed rows with explicit gaps',()=>{
  for(const kind of ['execution','review']){const f=fixture();f[kind]=null;if(kind==='execution')f.review=null;
    const row=build(f);assert.equal(row.passed,false);assert.equal(row.score,0);assert.equal(row.threshold,1);
    assert.ok(row.evidenceRefs.some(ref=>ref===`gap:missing-${kind}`));}
});
test('failed mandatory mechanical or rubric checks cannot pass',()=>{
  for(const kind of ['execution','review']){const f=fixture();f[kind].checks[0].pass=false;f.review.executionDigest=executionDigest(f.execution);
    const row=build(f);assert.equal(row.passed,false);assert.equal(row.score,0);assert.equal(row.hardFailureIds.length,1);}
});
test('observations cannot weaken mandatory check sets',()=>{
  for(const kind of ['execution','review'])for(const mutate of [checks=>checks.pop(),checks=>checks.push({...checks[0]}),checks=>checks.reverse(),checks=>checks[0].id='easier']){
    const f=fixture();mutate(f[kind].checks);f.review.executionDigest=executionDigest(f.execution);rejected(f);}
});
test('identity, definition digest, generation and review bindings are exact',()=>{
  for(const [kind,key,value] of [['execution','generationId','generation-2'],['execution','runtimeDigest',digest(9)],['execution','testDigest',digest(9)],['execution','inputDigest',digest(9)],['execution','caseId','other'],['execution','caseClass','other'],['execution','executorId','other'],['review','executionDigest',digest(9)],['review','rubricDigest',digest(9)],['review','reviewerId','native-runner'],['definition','caseId','other']]){
    const f=fixture();f[kind][key]=value;rejected(f);}
  const f=fixture();f.definition.reviewerId=f.definition.executorId;f.review.reviewerId=f.definition.executorId;rejected(f);
});
test('timestamps enforce freshness and execution-before-review ordering',()=>{
  for(const [kind,key,value] of [['execution','startedAt',0],['execution','completedAt',1600],['execution','startedAt',1150],['review','reviewedAt',1000],['review','reviewedAt',1600],['definition','maxAgeMs',0]]){
    const f=fixture();f[kind][key]=value;f.review.executionDigest=executionDigest(f.execution);rejected(f);}
  const f=fixture();f.now=2501;rejected(f);
});
test('raw, unexpected, malformed and accessor fields fail without exposing content',()=>{
  for(const mutate of [f=>f.execution.transcript='private text',f=>f.review.explanation='private text',f=>f.execution.outputDigest='not-a-digest',f=>f.execution.checks[0].pass='yes',f=>f.definition.mechanicalCheckIds=[],f=>f.definition.rubricCheckIds=['focus','focus'],f=>f.extra=true,f=>Object.defineProperty(f.execution,'payload',{enumerable:true,get(){throw Error('must not execute');}})]){
    const f=fixture();mutate(f);rejected(f);}
  const f=fixture();f.execution=null;rejected(f);
});
test('canonical digest ignores object insertion order but binds every execution field',()=>{
  const f=fixture();f.execution=Object.fromEntries(Object.entries(f.execution).reverse());assert.equal(build(f).passed,true);
  f.execution.outputDigest=digest(7);rejected(f);
});
