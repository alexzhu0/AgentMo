import { createHash } from 'node:crypto';

function fail() { throw Object.assign(new Error('Course Wiki corpus consent refused the operation.'), {code:'COURSE_WIKI_CONSENT_REJECTED'}); }
function digest(value) {return typeof value==='string'&&/^sha256:[a-f0-9]{64}$/.test(value);}
function exactKeys(value,keys) {return value&&typeof value==='object'&&!Array.isArray(value)&&JSON.stringify(Object.keys(value).sort())===JSON.stringify([...keys].sort());}

export function corpusIdentity(documents) {
  if(!Array.isArray(documents)||!documents.length)fail();
  const sourceDigests=[];
  for(const document of documents){if(!document||typeof document!=='object'||!digest(document.sourceDigest))fail();sourceDigests.push(document.sourceDigest);}
  const canonical=JSON.stringify({version:1,sourceDigests:[...new Set(sourceDigests)].sort()});
  return 'sha256:'+createHash('sha256').update(canonical).digest('hex');
}

export function validateCorpusConsent(consent,expected={}) {
  if(!expected||typeof expected!=='object'||Array.isArray(expected))fail();
  const {corpusDigest,provider}=expected;
  if(!exactKeys(consent,['version','corpusDigest','provider','purpose','confirmed'])||!digest(corpusDigest)||provider!=='deepseek'
    ||consent.version!==1||consent.corpusDigest!==corpusDigest||consent.provider!==provider||consent.purpose!=='wiki-and-qa'||consent.confirmed!==true)fail();
  return consent;
}
