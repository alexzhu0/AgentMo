import test from 'node:test';
import assert from 'node:assert/strict';

let corpus = {};
try { corpus = await import('../src/course-wiki-corpus.js'); } catch {}

const A = {name:'lesson-a.md',sourceDigest:'sha256:'+'a'.repeat(64)};
const B = {name:'lesson-b.txt',sourceDigest:'sha256:'+'b'.repeat(64)};

test('corpus identity is a filename-independent set of source digests',()=>{
  assert.equal(typeof corpus.corpusIdentity,'function');
  const expected=corpus.corpusIdentity([A,B]);
  assert.equal(corpus.corpusIdentity([B,A]),expected);
  assert.equal(corpus.corpusIdentity([A,{...A,name:'renamed-a.docx'},B]),expected);
  assert.notEqual(corpus.corpusIdentity([{...A,sourceDigest:'sha256:'+'c'.repeat(64)},B]),expected);
});

test('corpus identity rejects absent or malformed source sets',()=>{
  assert.equal(typeof corpus.corpusIdentity,'function');
  for(const value of [undefined,[],[{}],[{sourceDigest:'a'.repeat(64)}]]) assert.throws(()=>corpus.corpusIdentity(value),{code:'COURSE_WIKI_CONSENT_REJECTED'});
});

test('consent is exact and bound to the selected corpus and provider',()=>{
  assert.equal(typeof corpus.validateCorpusConsent,'function');
  const corpusDigest=corpus.corpusIdentity([A,B]);
  const consent={version:1,corpusDigest,provider:'deepseek',purpose:'wiki-and-qa',confirmed:true};
  assert.equal(corpus.validateCorpusConsent(consent,{corpusDigest,provider:'deepseek'}),consent);
  for(const candidate of [undefined,{...consent,corpusDigest:'sha256:'+'0'.repeat(64)},{...consent,provider:'other'},{...consent,confirmed:false},{...consent,extra:true}]) {
    assert.throws(()=>corpus.validateCorpusConsent(candidate,{corpusDigest,provider:'deepseek'}),{code:'COURSE_WIKI_CONSENT_REJECTED'});
  }
  assert.throws(()=>corpus.validateCorpusConsent(consent,null),{code:'COURSE_WIKI_CONSENT_REJECTED'});
  assert.throws(()=>corpus.validateCorpusConsent(consent,{corpusDigest,provider:'other'}),{code:'COURSE_WIKI_CONSENT_REJECTED'});
});
