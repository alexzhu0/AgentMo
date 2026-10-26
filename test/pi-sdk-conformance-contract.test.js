import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import { readFile, access } from 'node:fs/promises';
import childProcess from 'node:child_process';
import http from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { withPiTargetFixture, digest } from './helpers/pi-native-fixture.js';
import { buildPiSdkConformancePreview, runPiSdkConformance } from '../scripts/pi-sdk-conformance.js';
import { BUILDER_NPM_TARBALL_INVENTORY, validateBuilderNpmTarballInventory } from '../src/builder-package.js';
const root = new URL('../',import.meta.url);
test('ships every Pi source and browser asset without installing the SDK',async()=>{
  const fs=await import('node:fs/promises');const names=(await fs.readdir(new URL('src/',root))).filter(n=>n.startsWith('pi-')).map(n=>`src/${n}`);
  names.push('src/targets/pi.js','src/targets/pi-package.js');const pkg=JSON.parse(await readFile(new URL('package.json',root),'utf8'));
  for(const name of names) { assert.ok(pkg.files.includes(name),name);assert.ok(BUILDER_NPM_TARBALL_INVENTORY.includes(name),name);assert.throws(()=>validateBuilderNpmTarballInventory(BUILDER_NPM_TARBALL_INVENTORY.filter(p=>p!==name))); }
  assert.equal(Object.keys({...pkg.dependencies,...pkg.optionalDependencies}).some(n=>n.includes('pi-coding-agent')),false);
  assert.equal(pkg.scripts.check.includes('node scripts/pi-sdk-conformance'),false);
});
test('requires the exact conformance preview before spawn listen or workspace creation',async()=>{
  await withPiTargetFixture(async f=>{
    const targetPaths={sdkRoot:f.sdkRoot,nodeExecutablePath:f.nodeExecutablePath,lockFilePath:f.lockFilePath};const workspaceRoot=path.join(f.sdkRoot,'conformance-absent');const preview=await buildPiSdkConformancePreview({targetPaths,workspaceRoot});
    const options={preview,approvedPreviewDigest:digest(Buffer.from(`${JSON.stringify(preview,null,2)}\n`)),targetPaths,workspaceRoot};
    const spawn=childProcess.spawn,server=http.createServer;let effects=0;
    childProcess.spawn=()=>{effects++;throw new Error('unexpected spawn');};http.createServer=()=>{effects++;throw new Error('unexpected server');};syncBuiltinESMExports();
    try {
      for(const o of [{...options,approvedPreviewDigest:undefined},{...options,workspaceRoot:path.join(f.sdkRoot,'changed')},{...options,targetPaths:{...targetPaths,sdkRoot:path.join(f.sdkRoot,'wrong')}},{...options,preview:{...preview,cases:['weaker']}}])await assert.rejects(runPiSdkConformance(o));
      await assert.rejects(access(workspaceRoot));assert.equal(effects,0);
    } finally {childProcess.spawn=spawn;http.createServer=server;syncBuiltinESMExports();}
  });
});

test('limits the external SDK import to the reviewed Pi loader expression',async()=>{
  const {analyzeJavaScriptSource}=await import('../src/javascript-static-analysis.js');
  const source=await readFile(new URL('src/pi-sdk.js',root),'utf8');
  const loaders=analyzeJavaScriptSource(source,{file:'src/pi-sdk.js'}).loaders;
  assert.equal(loaders.filter(l=>l.kind==='pi-sdk-import').length,1);
  for(const changed of [source.replace("'dist/index.js'","'arbitrary.js'"),source.replace('targetPaths.sdkRoot','unapprovedRoot')])assert.throws(()=>analyzeJavaScriptSource(changed,{file:'src/pi-sdk.js'}));
  assert.throws(()=>analyzeJavaScriptSource(source,{file:'src/other.js'}));
});

test('imports core modules in fresh processes without an installed SDK',async()=>{
  const {spawnSync}=await import('node:child_process');
  for(const name of ['run-state','runtime-plan','build-plan','scaffold-files','delivery-report','artifact-registry']) {
    const result=spawnSync(process.execPath,['--input-type=module','-e',`await import('./src/${name}.js')`],{cwd:root,encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);
  }
});
