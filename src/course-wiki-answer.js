import {materializeCitationSelections} from './course-wiki-documents.js';

const INPUT_FAILURES=new Set([
  'COURSE_WIKI_REQUEST_INVALID',
  'COURSE_WIKI_DIAGNOSTIC_INVALID',
  'COURSE_WIKI_LIVE_NOT_AUTHORIZED',
  'COURSE_WIKI_CONTEXT_MISSING',
  'COURSE_WIKI_EVIDENCE_CONTEXT_MISSING',
  'COURSE_WIKI_EVIDENCE_TOO_LARGE',
  'COURSE_WIKI_DUPLICATE_REQUEST',
  'COURSE_WIKI_WORKSPACE_INVALID',
]);
const BUDGET_FAILURES=new Set(['COURSE_WIKI_ALLOWANCE_EXHAUSTED']);

function fail(){throw Object.assign(new Error('Course Wiki model response was rejected.'),{code:'COURSE_WIKI_MODEL_RESPONSE_INVALID'});}

function hasExactKeys(value,keys){
  return value&&typeof value==='object'&&!Array.isArray(value)
    &&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());
}

function validText(value,maxLength){
  return typeof value==='string'&&!!value.trim()&&value.length<=maxLength;
}

export function validateCourseSelection(value,documents,options={}){
  const stage=options?.stage;
  if(stage==='route'){
    if(hasExactKeys(value,['kind','answer'])&&value.kind==='conversation'
      &&validText(value.answer,8000)&&/\p{Script=Han}/u.test(value.answer)){
      return {kind:'conversation',answer:value.answer};
    }
    if(hasExactKeys(value,['kind','query'])&&value.kind==='search'&&typeof value.query==='string'
      &&!!value.query.trim()&&value.query.length<=160&&/^[A-Za-z0-9 ,'-]+$/.test(value.query)){
      return {kind:'search',query:value.query};
    }
    fail();
  }

  const allowedKinds=stage==='small-select'
    ?['conversation','insufficient_evidence','grounded-selection']
    :stage==='retrieved-select'?['insufficient_evidence','grounded-selection']:[];
  if(!allowedKinds.includes(value?.kind))fail();
  if(value.kind==='conversation'){
    if(!hasExactKeys(value,['kind','answer'])||!validText(value.answer,8000)||!/\p{Script=Han}/u.test(value.answer))fail();
    return {kind:'conversation',answer:value.answer};
  }
  if(value.kind==='insufficient_evidence'){
    if(!hasExactKeys(value,['kind']))fail();
    return {kind:'insufficient_evidence'};
  }
  if(!hasExactKeys(value,['kind','resolvedQuestion','selections'])
    ||!validText(value.resolvedQuestion,500)||!Array.isArray(value.selections)
    ||value.selections.length===0||value.selections.length>20)fail();
  const seen=new Set();
  for(const selection of value.selections){
    if(!hasExactKeys(selection,['sourceDigest','fromLine','toLine']))fail();
    const key=JSON.stringify([selection.sourceDigest,selection.fromLine,selection.toLine]);
    if(seen.has(key))fail();
    seen.add(key);
  }
  let citations;
  try{citations=materializeCitationSelections(value.selections,documents);}catch{fail();}
  return {kind:'grounded-selection',resolvedQuestion:value.resolvedQuestion,citations};
}

export function validateCourseAnswer(value,documents){
  if(!value||typeof value!=='object'||Array.isArray(value)
    ||JSON.stringify(Object.keys(value).sort())!==JSON.stringify(['answer','citations','kind'])
    ||typeof value.answer!=='string'||!value.answer.trim()||value.answer.length>8000
    ||!/\p{Script=Han}/u.test(value.answer)||!Array.isArray(value.citations)||value.citations.length>20)fail();
  switch(value.kind){
    case 'conversation':
    case 'insufficient_evidence':
      if(value.citations.length)fail();
      return {kind:value.kind,answer:value.answer,citations:[]};
    case 'grounded': {
      if(!value.citations.length)fail();
      let citations;try{citations=materializeCitationSelections(value.citations,documents);}catch{fail();}
      return {kind:value.kind,answer:value.answer,citations};
    }
    default:fail();
  }
}

export function courseFailureStatus(code){
  if(INPUT_FAILURES.has(code))return 400;
  if(code==='COURSE_WIKI_CONSENT_REJECTED')return 403;
  if(code==='COURSE_WIKI_OPERATION_BUSY')return 409;
  if(BUDGET_FAILURES.has(code))return 429;
  return 502;
}
