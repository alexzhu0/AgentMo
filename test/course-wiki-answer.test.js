import test from 'node:test';
import assert from 'node:assert/strict';

import {courseFailureStatus,validateCourseAnswer,validateCourseSelection} from '../src/course-wiki-answer.js';

const digest='sha256:'+'1'.repeat(64);
const documents=[{sourceDigest:digest,lines:['NOUNS.','A noun names a person, place, or thing.']}];
const selectionDocuments=[{sourceDigest:digest,lines:['Overview: nouns name things.','Examples: person, place, or thing.','Unrelated third line.']}];

test('conversation answers require the exact citation-free typed shape',()=>{
  assert.deepEqual(validateCourseAnswer({kind:'conversation',answer:'你好，请问想了解哪份材料？',citations:[]},[]),{
    kind:'conversation',answer:'你好，请问想了解哪份材料？',citations:[],
  });
  for(const value of[
    {kind:'conversation',answer:'你好。',citations:[{sourceDigest:digest,fromLine:1,toLine:1}]},
    {kind:'conversation',answer:'你好。',citations:[],missingEvidence:true},
    {kind:'conversation',answer:'hello',citations:[]},
  ])assert.throws(()=>validateCourseAnswer(value,documents),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});
});

test('grounded answers require at least one exact materialized source selection',()=>{
  assert.deepEqual(validateCourseAnswer({kind:'grounded',answer:'教材中的定义。',citations:[{sourceDigest:digest,fromLine:1,toLine:2}]},documents),{
    kind:'grounded',answer:'教材中的定义。',citations:[{sourceDigest:digest,fromLine:1,toLine:2,quote:'NOUNS.\nA noun names a person, place, or thing.'}],
  });
  assert.throws(()=>validateCourseAnswer({kind:'grounded',answer:'教材中的定义。',citations:[]},documents),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});
  assert.throws(()=>validateCourseAnswer({kind:'grounded',answer:'伪造来源。',citations:[{sourceDigest:'sha256:'+'0'.repeat(64),fromLine:1,toLine:1}]},documents),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});
});

test('insufficient-evidence answers are typed and cannot mix citations or legacy fields',()=>{
  assert.deepEqual(validateCourseAnswer({kind:'insufficient_evidence',answer:'当前材料没有提供这项信息。',citations:[]},documents),{
    kind:'insufficient_evidence',answer:'当前材料没有提供这项信息。',citations:[],
  });
  for(const value of[
    {kind:'insufficient_evidence',answer:'当前材料没有提供这项信息。',citations:[{sourceDigest:digest,fromLine:1,toLine:1}]},
    {kind:'insufficient_evidence',answer:'当前材料没有提供这项信息。',citations:[],missingEvidence:true},
    {kind:'unsupported',answer:'当前材料没有提供这项信息。',citations:[]},
  ])assert.throws(()=>validateCourseAnswer(value,documents),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});
});

test('failure statuses keep request, budget, and model/upstream failures distinct',()=>{
  assert.equal(courseFailureStatus('COURSE_WIKI_REQUEST_INVALID'),400);
  assert.equal(courseFailureStatus('COURSE_WIKI_DUPLICATE_REQUEST'),400);
  assert.equal(courseFailureStatus('COURSE_WIKI_ALLOWANCE_EXHAUSTED'),429);
  assert.equal(courseFailureStatus('COURSE_WIKI_BUDGET_REJECTED'),502);
  assert.equal(courseFailureStatus('COURSE_WIKI_MODEL_JSON_INVALID'),502);
  assert.equal(courseFailureStatus('COURSE_WIKI_UPSTREAM_UNAVAILABLE'),502);
  assert.equal(courseFailureStatus('COURSE_WIKI_PRIVATE_DETAIL'),502);
});

test('exact consent mismatch and operation contention are client precondition failures',()=>{
  assert.equal(courseFailureStatus('COURSE_WIKI_CONSENT_REJECTED'),403);
  assert.equal(courseFailureStatus('COURSE_WIKI_OPERATION_BUSY'),409);
});

test('exact evidence context refusal is 400 without widening unknown size errors',()=>{
  assert.equal(courseFailureStatus('COURSE_WIKI_EVIDENCE_TOO_LARGE'),400);
  assert.equal(courseFailureStatus('COURSE_WIKI_PRIVATE_TOO_LARGE'),502);
});

test('selection stages enforce their strict response unions',()=>{
  assert.deepEqual(validateCourseSelection({kind:'conversation',answer:'你好。'},selectionDocuments,{stage:'route'}),{
    kind:'conversation',answer:'你好。',
  });
  const boundaryQuery='a'.repeat(160);
  assert.deepEqual(validateCourseSelection({kind:'search',query:boundaryQuery},selectionDocuments,{stage:'route'}),{
    kind:'search',query:boundaryQuery,
  });
  for(const query of ['名词的例子','a'.repeat(161)])assert.throws(()=>validateCourseSelection({kind:'search',query},selectionDocuments,{stage:'route'}),{
    code:'COURSE_WIKI_MODEL_RESPONSE_INVALID',
  });
  assert.deepEqual(validateCourseSelection({kind:'insufficient_evidence'},selectionDocuments,{stage:'small-select'}),{
    kind:'insufficient_evidence',
  });
  const grounded=validateCourseSelection({
    kind:'grounded-selection',resolvedQuestion:'名词是什么，有哪些例子？',
    selections:[{sourceDigest:digest,fromLine:1,toLine:1},{sourceDigest:digest,fromLine:2,toLine:2}],
  },selectionDocuments,{stage:'small-select'});
  assert.deepEqual(grounded,{kind:'grounded-selection',resolvedQuestion:'名词是什么，有哪些例子？',citations:[
    {sourceDigest:digest,fromLine:1,toLine:1,quote:'Overview: nouns name things.'},
    {sourceDigest:digest,fromLine:2,toLine:2,quote:'Examples: person, place, or thing.'},
  ]});
  assert.equal(Object.hasOwn(grounded,'answer'),false);
  assert.deepEqual(validateCourseSelection({kind:'insufficient_evidence'},selectionDocuments,{stage:'retrieved-select'}),{
    kind:'insufficient_evidence',
  });
  assert.throws(()=>validateCourseSelection({kind:'search',query:'名词'},selectionDocuments,{stage:'retrieved-select'}),{
    code:'COURSE_WIKI_MODEL_RESPONSE_INVALID',
  });
});

test('grounded selections require bounded nonempty question and valid active source ranges',()=>{
  const valid={kind:'grounded-selection',resolvedQuestion:'名词是什么？',selections:[{sourceDigest:digest,fromLine:1,toLine:2}]};
  for(const patch of [
    {resolvedQuestion:''},
    {resolvedQuestion:'x'.repeat(501)},
    {selections:[{sourceDigest:'sha256:'+'0'.repeat(64),fromLine:1,toLine:1}]},
    {selections:[{sourceDigest:'sha256:'+'2'.repeat(64),fromLine:1,toLine:1}]},
    {selections:[{sourceDigest:digest,fromLine:2,toLine:1}]},
    {selections:[{sourceDigest:digest,fromLine:1,toLine:4}]},
    {selections:[]},
    {selections:Array.from({length:21},()=>({sourceDigest:digest,fromLine:1,toLine:1}))},
    {selections:[{sourceDigest:digest,fromLine:1,toLine:1,quote:'forged'}]},
    {answer:'草稿'},
  ])assert.throws(()=>validateCourseSelection({...valid,...patch},selectionDocuments,{stage:'small-select'}),{
    code:'COURSE_WIKI_MODEL_RESPONSE_INVALID',
  });
  assert.throws(()=>validateCourseSelection({...valid,selections:[valid.selections[0],valid.selections[0]]},selectionDocuments,{stage:'retrieved-select'}),{
    code:'COURSE_WIKI_MODEL_RESPONSE_INVALID',
  });
});

test('conversation and insufficient-evidence selections reject selections fields',()=>{
  for(const [value,stage] of [
    [{kind:'conversation',answer:'你好。',selections:[]},'route'],
    [{kind:'conversation',answer:'你好。',selections:[]},'small-select'],
    [{kind:'insufficient_evidence',selections:[]},'small-select'],
    [{kind:'insufficient_evidence',selections:[]},'retrieved-select'],
  ])assert.throws(()=>validateCourseSelection(value,selectionDocuments,{stage}),{
    code:'COURSE_WIKI_MODEL_RESPONSE_INVALID',
  });
});

test('selection validation does not loosen the public answer contract',()=>{
  assert.throws(()=>validateCourseAnswer({kind:'grounded',answer:'教材中的定义。',citations:[]},documents),{
    code:'COURSE_WIKI_MODEL_RESPONSE_INVALID',
  });
  for(const kind of ['conversation','insufficient_evidence'])assert.throws(()=>validateCourseAnswer({
    kind,answer:'中文答案。',citations:[{sourceDigest:digest,fromLine:1,toLine:1,quote:'Overview: nouns name things.'}],
  },documents),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});
});
