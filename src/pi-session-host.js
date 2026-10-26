import { randomUUID } from 'node:crypto';
import { mkdir, lstat, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { createPiSession, piFinalText } from './pi-sdk.js';
import { validatePiNativeBinding, validatePiApprovedCases, piHash, piBytes, piKeys, piIdentity, piReject, readPiPrivateFile } from './pi-install-plan.js';
import { writeNativeChatFile } from './native-chat-files.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const terminal = state => ['completed', 'failed', 'interrupted'].includes(state);
const fail = (httpStatus = 409) => { throw Object.assign(new Error('Pi session unavailable.'), { httpStatus }); };

export async function createPiSessionHost({ stateRoot, binding, sdk, turnClient, approvedCases = [] }) {
  if (!validatePiNativeBinding(binding) || piHash(stateRoot) !== binding.stateRootDigest
    || !validatePiApprovedCases(approvedCases) || ['admit', 'finish', 'state', 'status'].some(k => typeof turnClient?.[k] !== 'function')) piReject();
  const bindingDigest = piHash(piBytes(binding)), roots = new Map(), rooms = new Map(), adapters = new Map();
  const metadataQueues = new Map(), unpersisted = new Set();
  const roomExclusive = (id, fn) => {
    const result = (metadataQueues.get(id) ?? Promise.resolve()).then(fn);
    metadataQueues.set(id, result.catch(() => {})); return result;
  };
  const revisions = new Map(), listeners = new Set(); let closed = false, active = null;
  const system = await readPiPrivateFile(path.join(stateRoot, 'system.md'));
  const systemPrompt = new TextDecoder('utf-8', { fatal: true }).decode(system.bytes);
  async function directory(dir, expected) {
    const s = await lstat(dir, { bigint: true });
    if (await realpath(dir) !== dir || !s.isDirectory() || s.isSymbolicLink() || (s.mode & 0o777n) !== 0o700n
      || s.uid !== BigInt(process.getuid())) piReject();
    const identity = piIdentity(s); if (expected && !isDeepStrictEqual(identity, expected)) piReject(); return identity;
  }
  async function checkRoots() {
    for (const name of ['', 'sessions', 'turns']) {
      const identity = await directory(path.join(stateRoot, name), roots.get(name)); roots.set(name, identity);
    }
    const now = await readPiPrivateFile(path.join(stateRoot, 'system.md'));
    if (!now.bytes.equals(system.bytes) || !isDeepStrictEqual(now.identity, system.identity)) piReject();
  }
  await checkRoots();
  const roomPath = id => path.join(stateRoot, 'sessions', id);
  async function optionalFile(filePath) {
    try {
      const value = JSON.parse((await readPiPrivateFile(filePath)).bytes);
      if (!value || typeof value !== 'object' || Array.isArray(value)) piReject();
      return value;
    }
    catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  }
  const checkRoom = id => roomExclusive(id, () => checkRoomUnlocked(id));
  async function checkRoomUnlocked(id) {
    await checkRoots(); if (!UUID.test(id) || !rooms.has(id)) fail(404);
    const registration = rooms.get(id), dir = roomPath(id);
    await directory(dir, registration.directoryIdentity);
    const observed = await optionalFile(path.join(dir, 'registration.json'));
    if (!isDeepStrictEqual(observed, registration)) piReject();
    const meta = await optionalFile(path.join(dir, 'sdk-session.json'));
    if (meta && (!piKeys(meta, ['sessionId', 'bindingDigest', 'fileName']) || meta.sessionId !== id || meta.bindingDigest !== bindingDigest
      || typeof meta.fileName !== 'string' || path.basename(meta.fileName) !== meta.fileName || !meta.fileName.endsWith(`_${id}.jsonl`))) piReject();
    const allowed = ['registration.json', 'sdk-session.json', 'sdk-file.json', ...(meta ? [meta.fileName] : [])];
    if ((await readdir(dir)).some(name => !allowed.includes(name))) piReject();
    return meta;
  }
  for (const id of await readdir(path.join(stateRoot, 'sessions'))) {
    if (!UUID.test(id)) piReject();
    await directory(roomPath(id));
    const r = await optionalFile(path.join(roomPath(id), 'registration.json'));
    if (!piKeys(r, ['schemaVersion', 'id', 'createdAt', 'bindingDigest', 'rootIdentity', 'directoryIdentity'])
      || r.schemaVersion !== 'agentmo.pi-session-registration.v1' || r.id !== id || r.bindingDigest !== bindingDigest
      || !isDeepStrictEqual(r.rootIdentity, roots.get('')) || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/u.test(r.createdAt)) piReject();
    rooms.set(id, r); await checkRoom(id);
  }
  const observeSdkFile = (id, meta) => roomExclusive(id, () => observeSdkFileUnlocked(id, meta));
  async function observeSdkFileUnlocked(id, meta) {
    const filePath = path.join(roomPath(id), meta.fileName);
    const observed = await readPiPrivateFile(filePath);
    const marker = { sessionId: id, bindingDigest, fileName: meta.fileName, identity: observed.identity };
    const markerPath = path.join(roomPath(id), 'sdk-file.json');
    const prior = await optionalFile(markerPath);
    if (prior) { if (!isDeepStrictEqual(prior, marker)) piReject(); }
    else await writeNativeChatFile({ filePath: markerPath, bytes: piBytes(marker) });
    unpersisted.delete(id); return filePath;
  }
  async function adapter(id, forPrompt = false) {
    let meta = await checkRoom(id), sessionFile = null;
    if (meta) {
      try { sessionFile = await observeSdkFile(id, meta); }
      catch (e) {
        if (e.code !== 'ENOENT') throw e;
        if (adapters.has(id) && unpersisted.has(id) && !await optionalFile(path.join(roomPath(id), 'sdk-file.json'))) return adapters.get(id);
        if (!forPrompt) {
          if (await optionalFile(path.join(roomPath(id), 'sdk-file.json'))) throw e;
          return null;
        }
        sessionFile = await roomExclusive(id, async () => {
          if (!isDeepStrictEqual(await checkRoomUnlocked(id), meta)
            || await optionalFile(path.join(roomPath(id), 'sdk-file.json')) || (await turns(id)).length) throw e;
          // The SDK leaves an untouched prewarm in memory; only proven empty rooms may recover it.
          await writeNativeChatFile({ filePath: path.join(roomPath(id), meta.fileName), bytes: Buffer.from(JSON.stringify({
            type: 'session', version: sdk.CURRENT_SESSION_VERSION, id, timestamp: new Date().toISOString(), cwd: stateRoot,
          }) + '\n') });
          return observeSdkFileUnlocked(id, meta);
        });
      }
    }
    if (adapters.has(id)) return adapters.get(id);
    if (!meta && !forPrompt) return null;
    const value = await createPiSession({ sdk, config: { stateRoot, sessionDir: roomPath(id), sessionId: id, proxyPort: binding.proxyPort, systemPrompt },
      sessionFile, proxyCredential: '0'.repeat(64) });
    if (!meta) {
      unpersisted.add(id);
      meta = { sessionId: id, bindingDigest, fileName: path.basename(value.getSessionFile()) };
      await roomExclusive(id, () => writeNativeChatFile({ filePath: path.join(roomPath(id), 'sdk-session.json'), bytes: piBytes(meta) }));
    }
    value.subscribe(() => notify(id)); adapters.set(id, value); return value;
  }
  function notify(sessionId) {
    revisions.set(sessionId, (revisions.get(sessionId) ?? 0) + 1);
    for (const listener of listeners) listener(sessionId);
  }
  async function turns(id) {
    const result = [];
    for (const name of (await readdir(path.join(stateRoot, 'turns'))).filter(n => n.endsWith('.received.json'))) {
      const observed = await readPiPrivateFile(path.join(stateRoot, 'turns', name)), row = JSON.parse(observed.bytes);
      if (row.sessionId !== id) continue;
      if (row.bindingDigest !== bindingDigest || name !== `${row.turnId}.received.json`) piReject();
      const state = await turnClient.state(row.turnId);
      if (state.sessionId !== id || state.turnId !== row.turnId) piReject();
      result.push({ state, born: BigInt(observed.identity.birthtimeNs) });
    }
    return result.sort((a, b) => a.born < b.born ? -1 : a.born > b.born ? 1 : a.state.turnId.localeCompare(b.state.turnId)).map(r => r.state);
  }
  async function finalText(state) {
    const value = await adapter(state.sessionId); if (!value) piReject();
    const completion = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'turns', `${state.turnId}.completed.json`))).bytes);
    if (completion.sessionId !== state.sessionId || completion.turnId !== state.turnId || completion.bindingDigest !== bindingDigest
      || completion.status !== 'completed') piReject();
    const entry = value.readEntries().find(e => e.id === completion.finalEntryId && e.type === 'message');
    return piFinalText(entry?.message);
  }
  async function run(input, token) {
    try {
      const value = await adapter(input.sessionId, true);
      if (closed) fail();
      await value.setProxyCredential(token);
      const result = await value.prompt(input.text);
      await observeSdkFile(input.sessionId, await checkRoom(input.sessionId));
      await turnClient.finish({ sessionId: input.sessionId, turnId: input.turnId, status: 'completed', finalEntryId: result.finalEntryId });
    } catch {
      const meta = await checkRoom(input.sessionId).catch(() => null);
      if (meta) await observeSdkFile(input.sessionId, meta).catch(() => {});
      try { await turnClient.finish({ sessionId: input.sessionId, turnId: input.turnId, status: closed ? 'interrupted' : 'failed',
        causeCode: closed ? 'PI_INTERRUPTED' : 'PI_SDK_FAILURE' }); }
      catch { closed = true; }
    } finally { if (active?.turnId === input.turnId) active = null; notify(input.sessionId); }
  }
  const host = {
    status: async () => { await checkRoots(); const status = await turnClient.status(); return closed || active ? { canSend: false, nextCaseId: null } : status; },
    createSession: async () => {
      if (closed || active) fail(); await checkRoots(); const id = randomUUID(), dir = roomPath(id);
      await mkdir(dir, { mode: 0o700 });
      const registration = { schemaVersion: 'agentmo.pi-session-registration.v1', id, createdAt: new Date().toISOString(), bindingDigest,
        rootIdentity: roots.get(''), directoryIdentity: await directory(dir) };
      await writeNativeChatFile({ filePath: path.join(dir, 'registration.json'), bytes: piBytes(registration) }); rooms.set(id, registration);
      return { id };
    },
    listSessions: async () => { await checkRoots(); for (const id of rooms.keys()) await checkRoom(id);
      return [...rooms.values()].map(({ id, createdAt }) => ({ id, createdAt })).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)); },
    readSession: async id => {
      await checkRoom(id); const value = await adapter(id), history = [];
      if (value) for (const entry of value.readEntries()) {
        const m = entry.message; if (entry.type !== 'message' || !m) continue;
        if (m.role === 'user') {
          const content = typeof m.content === 'string' ? m.content : Array.isArray(m.content) && m.content.every(p => p.type === 'text' && typeof p.text === 'string')
            ? m.content.map(p => p.text).join('\n') : null;
          if (content === null) piReject(); history.push({ role: 'user', content });
        } else if (m.role === 'assistant') { try { history.push({ role: 'assistant', content: piFinalText(m) }); } catch { /* An incomplete assistant message is not a final reply. */ } }
        else if (m.role !== 'system') piReject();
      }
      const states = await turns(id); for (const state of states.filter(s => s.status === 'completed')) await finalText(state);
      return { id, messages: history, turns: states };
    },
    submit: async input => {
      if (!piKeys(input, ['caseId', 'sessionId', 'turnId', 'text']) || !UUID.test(input.sessionId) || !UUID.test(input.turnId)
        || typeof input.text !== 'string' || !input.text.trim() || !input.text.isWellFormed() || [...input.text].length > 8000) fail(400);
      await checkRoom(input.sessionId);
      if (closed) fail();
      const admitted = await turnClient.admit({ caseId: input.caseId, sessionId: input.sessionId, turnId: input.turnId, inputDigest: piHash(input.text) });
      if (admitted.kind === 'existing') return admitted.turn;
      if (admitted.kind !== 'admitted' || typeof admitted.turnToken !== 'string') fail();
      const received = await turnClient.state(input.turnId);
      if (closed) return turnClient.finish({ sessionId: input.sessionId, turnId: input.turnId, status: 'interrupted', causeCode: 'PI_INTERRUPTED' });
      active = { turnId: input.turnId, sessionId: input.sessionId };
      active.promise = run(input, admitted.turnToken); return received;
    },
    async *events(turnId, { signal } = {}) {
      if (!UUID.test(turnId)) fail(404);
      const route = await turnClient.state(turnId); await checkRoom(route.sessionId);
      while (!signal?.aborted) {
        const revision = revisions.get(route.sessionId) ?? 0;
        const state = await turnClient.state(turnId); await checkRoom(state.sessionId);
        if (state.sessionId !== route.sessionId || state.turnId !== turnId) piReject();
        yield state.status === 'completed' ? { ...state, text: await finalText(state) } : state;
        if (terminal(state.status) || closed) return;
        await new Promise(resolve => {
          const done = id => { if (id !== undefined && id !== state.sessionId) return; listeners.delete(done); signal?.removeEventListener('abort', abort); resolve(); };
          const abort = () => done(); listeners.add(done); signal?.addEventListener('abort', abort, { once: true });
          if (signal?.aborted || closed || (revisions.get(state.sessionId) ?? 0) !== revision) done();
        });
      }
    },
    close: async () => {
      if (closed && !active && !adapters.size) return; closed = true; const pending = active;
      if (pending) await turnClient.finish({ sessionId: pending.sessionId, turnId: pending.turnId, status: 'interrupted', causeCode: 'PI_INTERRUPTED' }).catch(() => {});
      await Promise.allSettled([...adapters.values()].map(value => value.abort()));
      await pending?.promise;
      await Promise.allSettled([...adapters.values()].map(value => value.dispose())); adapters.clear(); unpersisted.clear();
      for (const listener of listeners) listener(); listeners.clear();
    },
  };
  for (const sessionId of new Set(approvedCases.map(c => c.sessionId))) await adapter(sessionId, true);
  return host;
}
