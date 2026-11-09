import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { buildDiscoveryWorkspace } from '../../src/discovery-source-workspace.js';
import { withPiPackageFixture } from './pi-native-fixture.js';

const fixtures = fileURLToPath(new URL('../fixtures/core-mvp/', import.meta.url));
export async function coreMvpSources(profile) {
  if (!['field-extractor', 'rule-labeler'].includes(profile)) throw new Error('Unknown synthetic profile');
  const need = JSON.parse(await readFile(path.join(fixtures, `${profile}.need.json`)));
  const manifest = JSON.parse(await readFile(path.join(fixtures, `${profile}.discovery.json`)));
  const workspace = await buildDiscoveryWorkspace(manifest, { sourceRoot: fixtures });
  if (!workspace.ok) throw new Error('Synthetic source intake rejected');
  return { need, manifest, db: workspace.discoveryDb, preserveFailure: true, workspace };
}
export async function withCoreMvpFixture(t, profile, fn) {
  const { need, manifest, db, workspace } = await coreMvpSources(profile);
  return withPiPackageFixture(async f => {
    const sourceRoot = path.join(f.root, 'sources');
    await mkdir(sourceRoot, { mode: 0o700 });
    await copyFile(path.join(fixtures, `${profile}.md`), path.join(sourceRoot, `${profile}.md`));
    return fn({ ...f, sourceRoot, workspace });
  }, { need, manifest, db, preserveFailure: true });
}

// House-style source harness: replace only process/network ownership, never admissions or budget.
export async function loadCoreModule(relative, overrides = {}) {
  const url = new URL(`../../${relative}`, import.meta.url);
  let source = await readFile(url, 'utf8');
  const bindings = {};
  for (const match of source.matchAll(/^import (.+) from '([^']+)';$/gmu)) {
    const module = await import(match[2].startsWith('.') ? new URL(match[2], url).href : match[2]);
    if (match[1].startsWith('{')) for (const name of match[1].slice(1, -1).split(',').map(x => x.trim())) bindings[name] = module[name];
    else bindings[match[1]] = module.default;
  }
  const exports = [...source.matchAll(/^export (?:async )?function (\w+)/gmu)].map(m => m[1]);
  source = source.replace(/^import .+ from '[^']+';\n/gmu, '').replace(/^export /gmu, '');
  Object.assign(bindings, overrides);
  return new Function(...Object.keys(bindings), `${source}\nreturn {${exports.join(',')}};`)(...Object.values(bindings));
}

export async function createCoreCliHarness(t, f, { upstreamStatus = 200 } = {}) {
  const { createPiSessionHost } = await import('../../src/pi-session-host.js');
  const { createPiTurnController, createPiBudgetHandler } = await import('../../src/pi-budget-proxy.js');
  const { consumeNativeAuthoritySet } = await import('../../src/native-chat-authority.js');
  const { preflightPiNative } = await import('../../src/pi-native-runtime.js');
  const { createPiChatHandler } = await import('../../src/pi-chat-server.js');
  const { fakePiSdk, finalMessage } = await import('./pi-sdk-fixture.js');
  const { piHttpRequest, piNativeRequest, piNativeResponse } = await import('./pi-http-fixture.js');
  const { stubPiUpstream } = await import('./pi-https-fixture.js');
  const { createPiConformanceHttpsRequest } = await import('../../scripts/pi-sdk-conformance.js');
  const { Readable, Writable } = await import('node:stream');
  const http = (await import('node:http')).default;
  const { piHash, piBytes } = await import('../../src/pi-install-plan.js');
  let starts = 0, stops = 0, handler;
  stubPiUpstream(t, async () => upstreamStatus === 200 ? piNativeResponse() : new Response('SYNTHETIC_BODY_MARKER', { status: upstreamStatus }));
  t.mock.method(http, 'request', createPiConformanceHttpsRequest(async (url, init) => {
    const parsed = new URL(url), req = Readable.from(init.body ? [Buffer.from(init.body)] : []), chunks = [];
    Object.assign(req, { method: init.method, url: parsed.pathname, headers: { ...init.headers, host: parsed.host } });
    const res = new Writable({ write(chunk, encoding, done) { chunks.push(Buffer.from(chunk)); done(); } });
    res.statusCode = 200; res.headersSent = false;
    res.writeHead = (status, headers) => { res.statusCode = status; res.headers = headers; res.headersSent = true; return res; };
    await handler(req, res);
    return new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers });
  }));
    const fake = fakePiSdk(), plans = [];
    const runner = await loadCoreModule('src/pi-cli-run.js', { startPiNative: async options => {
      const { planAdmission, sourceAdmissions, sourceFiles, stateRoot, authorityRoot, targetPaths, budgetRoot } = options;
      await preflightPiNative({ planAdmission, sourceAdmissions, sourceFiles, stateRoot, authorityRoot, targetPaths, budgetRoot });
      const plan = planAdmission.value; plans.push(plan); starts++;
      await consumeNativeAuthoritySet({ authorityRoot, stateRoot, plan, ordinaryApproval: options.ordinaryApproval,
        sensitiveDecisions: options.sensitiveDecisions, conflictApproval: options.conflictApproval });
      const controller = await createPiTurnController({ binding: plan.nativeBinding, stateRoot, approvedCases: plan.approvedCases, activationId: plan.activationId });
      const budget = createPiBudgetHandler({ binding: plan.nativeBinding, stateRoot, budgetRoot, apiKey: 'synthetic-only', controller });
      fake.sequence(async () => {
        const context = fake.calls.stream.at(-1).context;
        const latest = context.messages.at(-1).content;
        const text = typeof latest === 'string' ? latest : latest.map(p => p.text).join('');
        const reply = await piHttpRequest(budget, piNativeRequest(text), { 'x-api-key': fake.calls.credential.at(-1).credential });
        assert.equal(reply.statusCode, 200);
        return [{ type: 'message_end', message: finalMessage() }, { type: 'agent_settled', aborted: false }];
      });
      const host = await createPiSessionHost({ stateRoot, binding: plan.nativeBinding, sdk: fake.sdk, turnClient: controller, approvedCases: plan.approvedCases });
      const accessFile = path.join(stateRoot, 'attempts', `pi-run-${plan.installPlanDigest.slice(7)}-0.login.txt`);
      await writeFile(accessFile, 'a'.repeat(48), { mode: 0o600 });
      handler = createPiChatHandler({ host: '127.0.0.1:19492', origin: 'http://127.0.0.1:19492', sessionHost: host, loginSecret: 'a'.repeat(48), onStop: async () => {} });
      return { entry: { accessFile }, stop: async () => { stops++; await host.close(); await budget.close(); return { status: 'stopped', ownChildExited: true }; } };
    } });
    return { runner, plans, fake, stats: () => ({ starts, stops }) };
}
