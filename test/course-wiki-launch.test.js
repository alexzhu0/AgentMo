import assert from 'node:assert/strict';
import test from 'node:test';
import {resolveCourseWikiLaunch} from '../scripts/course-wiki-poc.mjs';

const root='/isolated/course-wiki';
test('selected-document page uses an explicit runtime root without creating a budget',()=>{
  assert.deepEqual(resolveCourseWikiLaunch(['--project',root]),{
    root,port:17892,
    liveAuthorization:{authorized:true,campaign:'course-wiki-selected-documents-v1',root},
  });
});
test('selected-document gateway uses the same authorization and fixed local channel',()=>{
  const launch=resolveCourseWikiLaunch(['--project',root,'--gateway']);
  assert.equal(launch.action,'gateway');assert.equal(launch.port,17893);
  assert.equal(launch.root,root);assert.equal(launch.liveAuthorization.root,root);
  assert.equal(launch.liveAuthorization.campaign,'course-wiki-selected-documents-v1');
});
test('project mode rejects ambiguous or hidden authorization and unsupported actions',()=>{
  for(const args of [
    ['--project',root,'--live'],['--project',root,'--root',root],
    ['--project',root,'--project',root],['--project','relative'],['--project','/'],
    ['--project',root,'--ask','hello'],['--project',root,'--prepare-workspace'],
    ['--project',root,'--gateway','--port','17893'],['--project'],
    ['--project',root,'--budget-root','/new-budget'],
  ])assert.throws(()=>resolveCourseWikiLaunch(args),{code:'COURSE_WIKI_LAUNCH_INVALID'});
});
test('legacy offline and exact sample launches retain their authorization boundary',()=>{
  assert.equal(resolveCourseWikiLaunch(['--root',root]).liveAuthorization,null);
  const sample=resolveCourseWikiLaunch(['--live']);
  assert.equal(sample.liveAuthorization.campaign,'course-wiki-interactive-2026-09-15');
  assert.notEqual(sample.root,root);
  assert.throws(()=>resolveCourseWikiLaunch(['--live','--root',root]),{code:'COURSE_WIKI_LAUNCH_INVALID'});
});
