import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPiSession, loadPiSdk } from '../src/pi-sdk.js';
import { fakePiSdk, finalMessage } from './helpers/pi-sdk-fixture.js';

export async function sdkFixture(t) {
  const oldUmask = process.umask(0o077); t.after(() => process.umask(oldUmask));
  const stateRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-sdk-'))); t.after(() => rm(stateRoot, { recursive: true, force: true }));
  const sessionId = randomUUID(), sessionDir = path.join(stateRoot, 'sessions', sessionId); await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const config = { stateRoot, sessionDir, sessionId, proxyPort: 19493, systemPrompt: '只根据当前会议整理摘要、决策、行动项和待确认问题。' };
  return { config, ...fakePiSdk() };
}

test('requires final message and settled without retrying', async t => {
  for (const events of [
    [{ type: 'agent_end', willRetry: false }],
    [{ type: 'message_end', message: finalMessage() }],
    [{ type: 'agent_settled', aborted: false }],
    [{ type: 'message_end', message: { ...finalMessage(), stopReason: 'length' } }, { type: 'agent_settled', aborted: false }],
    [{ type: 'message_end', message: finalMessage() }, { type: 'agent_settled', aborted: true }],
    [{ type: 'message_end', message: { ...finalMessage(), usage: { ...finalMessage().usage, output: 2049 } } }, { type: 'agent_settled', aborted: false }],
  ]) {
    const f = await sdkFixture(t); f.sequence(events);
    const session = await createPiSession({ sdk: f.sdk, config: f.config, sessionFile: null, proxyCredential: '0'.repeat(64) });
    await assert.rejects(session.prompt('/x @file !cmd')); assert.equal(f.calls.prompt.length, 1);
    await session.dispose();
  }
  const f = await sdkFixture(t), session = await createPiSession({ sdk: f.sdk, config: f.config, sessionFile: null, proxyCredential: '0'.repeat(64) });
  const result = await session.prompt('/x @file !cmd');
  assert.equal(result.text, '合成最终回复'); assert.ok(result.finalEntryId);
  assert.deepEqual(f.calls.prompt, [{ text: '/x @file !cmd', options: { expandPromptTemplates: false } }]);
  assert.equal(f.calls.settings.cacheWarming, 'off'); assert.equal(f.calls.settings.retry.enabled, false);
  assert.equal(f.calls.settings.retry.maxRetries, 0); assert.equal(f.calls.settings.retry.provider.maxRetries, 0);
  const actual = f.calls.create[0]; assert.equal(actual.noTools, 'all'); assert.deepEqual(actual.tools, []); assert.deepEqual(actual.customTools, []);
  assert.deepEqual(actual.resourceLoader.getSkills().skills, []); assert.deepEqual(actual.resourceLoader.getPrompts().prompts, []);
  assert.deepEqual(actual.resourceLoader.getAgentsFiles().agentsFiles, []);
  assert.equal(f.calls.runtime[0].refreshOnCreate, false); assert.equal(f.calls.runtime[0].allowModelNetwork, false);
  assert.equal(f.calls.runtime[0].modelsPath, null);
  assert.deepEqual(f.calls.stream[0].context.messages[0], { role: 'system', content: f.config.systemPrompt, timestamp: 0 });
  assert.ok(!JSON.stringify(f.calls.stream[0].context).includes('SYNTHETIC/HOST'));
  assert.equal(f.calls.stream[0].options.maxTokens, 2048); assert.equal(f.calls.stream[0].options.maxRetries, 0);
  await session.dispose();
});

test('refuses SDK loading outside an owned child before observing a target', async () => {
  await assert.rejects(loadPiSdk({ descriptorAdmission: {}, targetPaths: {} }));
});
