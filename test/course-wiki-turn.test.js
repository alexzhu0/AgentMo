import test from 'node:test';
import assert from 'node:assert/strict';
import { courseMessageText, projectCourseTurn } from '../src/course-wiki-turn.js';

test('projects the latest greeting as active and keeps prior turns as primitive history',()=>{
  const result=projectCourseTurn([
    {role:'system',content:'system instruction'},
    {role:'user',content:'旧题'},
    {role:'user',content:'你好'},
  ]);
  assert.equal(result.currentUserText,'你好');
  assert.deepEqual(result.historicalReference,[{role:'user',text:'旧题'}]);
  for(const message of result.historicalReference){
    assert.deepEqual(Object.keys(message).sort(),['role','text']);
    assert.equal(typeof message.role,'string');
    assert.equal(typeof message.text,'string');
  }
  assert.equal(result.historicalReference.some(message=>message.role==='system'),false);
  assert.equal(result.historicalReference.some(message=>Object.hasOwn(message,'content')),false);
});

test('keeps earlier assistant replies as reference, never active role input',()=>{
  const result=projectCourseTurn([{role:'assistant',content:'旧回答'},{role:'user',content:'你好'}]);
  assert.equal(result.currentUserText,'你好');
  assert.deepEqual(result.historicalReference,[{role:'assistant',text:'旧回答'}]);
});

test('preserves full current follow-up text and previous context',()=>{
  const followUp='它为什么这样？';
  const result=projectCourseTurn([{role:'user',content:'名词是什么？'},{role:'assistant',content:'名词指人或事物。'},{role:'user',content:followUp}]);
  assert.equal(result.currentUserText,followUp);
  assert.deepEqual(result.historicalReference,[{role:'user',text:'名词是什么？'},{role:'assistant',text:'名词指人或事物。'}]);
});

test('rejects a turn without a non-empty user message',()=>{
  for(const messages of [[],[{role:'assistant',content:'answer'}],[{role:'user',content:' \n '}],[{role:'system',content:'policy'}]]){
    assert.throws(()=>projectCourseTurn(messages),{code:'COURSE_WIKI_REQUEST_INVALID'});
  }
});

test('accepts only strict text-only message content',()=>{
  assert.equal(courseMessageText({role:'user',content:[{type:'text',text:'甲'},{type:'text',text:'乙'}]}),'甲\n乙');
  assert.throws(()=>courseMessageText({role:'user',content:[{type:'image',data:'hidden'}]}),{code:'COURSE_WIKI_REQUEST_INVALID'});
  assert.throws(()=>courseMessageText({role:'user',content:[{type:'text',text:'甲',extra:'ignored?'}]}),{code:'COURSE_WIKI_REQUEST_INVALID'});
});

test('accepts exactly 32 messages and preserves timestamp metadata on the supplied objects',()=>{
  const messages=Array.from({length:32},(_,index)=>({role:index===31?'user':'assistant',content:index===31?'当前问题':`历史${index}`,timestamp:index}));
  const originalTimestamps=messages.map(message=>message.timestamp);
  const result=projectCourseTurn(messages);
  assert.equal(result.currentUserText,'当前问题');
  assert.equal(result.historicalReference.length,31);
  assert.deepEqual(messages.map(message=>message.timestamp),originalTimestamps);
  assert.throws(()=>projectCourseTurn([...messages,{role:'assistant',content:'too many'}]),{code:'COURSE_WIKI_REQUEST_INVALID'});
});

test('rejects invalid roles',()=>{
  assert.throws(()=>projectCourseTurn([{role:'tool',content:'not a supported role'},{role:'user',content:'question'}]),{code:'COURSE_WIKI_REQUEST_INVALID'});
  assert.throws(()=>courseMessageText({role:'developer',content:'not allowed'}),{code:'COURSE_WIKI_REQUEST_INVALID'});
});

test('fails closed when the serialized turn projection exceeds 48 KiB',()=>{
  const messages=[{role:'user',content:'历史'.repeat(12000)},{role:'user',content:'当前问题'}];
  assert.throws(()=>projectCourseTurn(messages),{code:'COURSE_WIKI_REQUEST_TOO_LARGE'});
});
