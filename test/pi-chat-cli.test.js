import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, realpath, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { readPiCliText, runPiChatCli } from '../src/pi-chat-cli.js';
import { loadCoreModule } from './helpers/core-mvp-fixture.js';

async function fixture(t) {
  const sourceRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'pi-cli-text-')));
  t.after(() => rm(sourceRoot, { recursive: true, force: true })); return sourceRoot;
}

test('rejects forbidden or replaced files before reading', async t => {
  const sourceRoot = await fixture(t);
  for (const name of ['passwords.txt', 'api-key.txt', 'minimax_api_key.txt']) await writeFile(path.join(sourceRoot, name), 'benign synthetic marker');
  for (const relativePath of ['passwords.txt', 'api-key.txt', 'minimax_api_key.txt', '.env', '.env.md', 'auth.txt', '../outside.md', 'sessions/x.md']) {
    await assert.rejects(readPiCliText({ sourceRoot, relativePath }));
  }
  await writeFile(path.join(sourceRoot, 'data.md'), '😀'.repeat(8000));
  assert.equal([...(await readPiCliText({ sourceRoot, relativePath: 'data.md' })).text].length, 8000);
  await writeFile(path.join(sourceRoot, 'data.md'), '😀'.repeat(8001));
  await assert.rejects(readPiCliText({ sourceRoot, relativePath: 'data.md' }));
  await symlink(path.join(sourceRoot, 'data.md'), path.join(sourceRoot, 'link.md'));
  await assert.rejects(readPiCliText({ sourceRoot, relativePath: 'link.md' }));
  await writeFile(path.join(sourceRoot, 'invalid.txt'), Buffer.from([0xc3, 0x28]));
  await assert.rejects(readPiCliText({ sourceRoot, relativePath: 'invalid.txt' }));
});

test('requires fresh TTY confirmation for pasted and file text', async t => {
  const sourceRoot = await fixture(t), sessionId = randomUUID(), previews = [], sends = [], output = [];
  const cli = await loadCoreModule('src/pi-chat-cli.js', {
    listPiCliSessions: async () => [{ id: sessionId, createdAt: '2026-11-06T00:00:00.000Z' }],
    preparePiCliRequest: async o => { previews.push(o); return { confirmationCode: 'fresh-code', previewDigest: 'synthetic', maximumNewReservedFen: 31 }; },
    runApprovedPiCliRequest: async ({ confirmation }) => {
      if (confirmation !== 'fresh-code') return { status: 'declined' };
      sends.push(previews.at(-1).text); return { status: 'completed', replyText: 'actual reply', newReservedFen: 31, cleanup: { status: 'stopped' } };
    },
  });
  const lines = [`/use ${sessionId}`, '/paste', 'line 1', 'yes', '//end', '/end', 'old-code', 'Product: Atlas', 'fresh-code', '/quit'];
  const io = { isTTY: true, readLine: async () => lines.shift() ?? null, write: value => output.push(value) };
  await cli.runPiChatCli({ installed: { sourceAdmissions: { blueprint: { value: { agent_id: 'field-extractor' } } } }, sourceRoot, runtimeEnvFile: path.join(sourceRoot, 'never-read.env'), ports: { chat: 19492, proxy: 19493 }, io });
  assert.equal(previews[0].text, 'line 1\nyes\n/end');
  assert.deepEqual(sends, ['Product: Atlas']); assert.match(output.join(''), /actual reply/);
  await assert.rejects(runPiChatCli({ io: { ...io, isTTY: false } }));
});

test('a changed file invalidates confirmation without a send', async t => {
  const sourceRoot = await fixture(t), sessionId = randomUUID(); let calls = 0;
  await writeFile(path.join(sourceRoot, 'data.md'), 'Product: Atlas');
  const cli = await loadCoreModule('src/pi-chat-cli.js', {
    listPiCliSessions: async () => [{ id: sessionId }], preparePiCliRequest: async () => ({ confirmationCode: 'fresh-code' }),
    runApprovedPiCliRequest: async () => { calls++; throw new Error('must not send'); },
  });
  const lines = [`/use ${sessionId}`, '/file data.md', 'fresh-code', '/quit'];
  const io = { isTTY: true, readLine: async () => { const line = lines.shift(); if (line === 'fresh-code') await writeFile(path.join(sourceRoot, 'data.md'), 'changed'); return line ?? null; }, write() {} };
  await cli.runPiChatCli({ installed: { sourceAdmissions: { blueprint: { value: { agent_id: 'field-extractor' } } } }, sourceRoot, runtimeEnvFile: path.join(sourceRoot, 'never-read.env'), ports: { chat: 19492, proxy: 19493 }, io });
  assert.equal(calls, 0);
});


test('cleanup uncertainty is explicit and all request failures reject the CLI', async t => {
  const sourceRoot = await fixture(t), sessionId = randomUUID();
  for (const cleanupStatus of ['failed', 'stopped']) {
    const output = [], lines = [`/use ${sessionId}`, 'Product: Atlas', 'fresh-code'];
    const cli = await loadCoreModule('src/pi-chat-cli.js', {
      listPiCliSessions: async () => [{ id: sessionId }],
      preparePiCliRequest: async () => ({ confirmationCode: 'fresh-code' }),
      runApprovedPiCliRequest: async () => ({ status: 'failed', failureCode: 'AGENTMO_PI_CLI_CLEANUP_FAILED', newReservedFen: 31, cleanup: { status: cleanupStatus } }),
    });
    const io = { isTTY: true, readLine: async () => lines.shift() ?? null, write: s => output.push(s) };
    await assert.rejects(cli.runPiChatCli({ installed: { sourceAdmissions: { blueprint: { value: { agent_id: 'synthetic' } } } }, sourceRoot, runtimeEnvFile: path.join(sourceRoot, 'never-read.env'), ports: { chat: 19492, proxy: 19493 }, io }));
    if (cleanupStatus === 'failed') { assert.match(output.join(''), /停止未确认/); assert.doesNotMatch(output.join(''), /已停止/); }
    else assert.match(output.join(''), /已停止/);
  }
});

test('EOF at a preview or queued yes never dispatches a request', async t => {
  const sourceRoot = await fixture(t), sessionId = randomUUID(); let calls = 0;
  const cli = await loadCoreModule('src/pi-chat-cli.js', {
    listPiCliSessions: async () => [{ id: sessionId }],
    preparePiCliRequest: async () => ({ confirmationCode: 'fresh-code' }),
    runApprovedPiCliRequest: async ({ confirmation }) => { if (confirmation === 'fresh-code') calls++; return { status: 'declined' }; },
  });
  for (const ending of [null, 'yes']) {
    const lines = [`/use ${sessionId}`, 'Product: Atlas', ending];
    await cli.runPiChatCli({ installed: { sourceAdmissions: { blueprint: { value: { agent_id: 'synthetic' } } } }, sourceRoot,
      runtimeEnvFile: path.join(sourceRoot, 'never-read.env'), ports: { chat: 19492, proxy: 19493 }, io: { isTTY: true, readLine: async () => lines.shift() ?? null, write() {} } });
  }
  assert.equal(calls, 0);
});
