import { randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { lstat, readdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { validatePiNativeBinding, validatePiApprovedCases, piHash, piBytes, piKeys, piIdentity, piReject, readPiPrivateFile } from './pi-install-plan.js';
export { validatePiApprovedCases } from './pi-install-plan.js';
import { writeNativeChatFile } from './native-chat-files.js';
import { validateNativeChatRequest } from './native-chat-proxy.js';
import { validateCourseBudgetBinding, sendBudgetedCompletion } from './course-wiki-budget.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const CASE = /^[a-z][a-z0-9-]{0,63}$/u;
const TERMINAL = new Set(['completed', 'failed', 'interrupted']);
const STAGES = ['received', 'reserved', 'sent', 'completed', 'failed', 'interrupted'];
const CAUSES = new Set(['PI_REQUEST_INVALID', 'PI_SDK_FAILURE', 'PI_INTERRUPTED', 'PI_LOCAL_FAILURE',
  'COURSE_WIKI_NATIVE_TIMEOUT', 'COURSE_WIKI_UPSTREAM_TIMEOUT', 'COURSE_WIKI_UPSTREAM_RATE_LIMIT', 'COURSE_WIKI_UPSTREAM_UNAVAILABLE',
  'COURSE_WIKI_UPSTREAM_DENIED', 'COURSE_WIKI_UPSTREAM_NETWORK', 'COURSE_WIKI_UPSTREAM_RESPONSE_INVALID', 'COURSE_WIKI_BUDGET_REJECTED']);
const controllers = new WeakMap();
const fail = (httpStatus = 400) => { throw Object.assign(new Error('Pi request rejected.'), { httpStatus }); };
const publicTurn = row => ({ turnId: row.turnId, sessionId: row.sessionId, status: row.status,
  ...(row.causeCode ? { causeCode: row.causeCode } : {}), ...(row.upstreamStatus === undefined ? {} : { upstreamStatus: row.upstreamStatus }) });
export function validatePiPublicTurn(value) {
  return piKeys(value, ['turnId', 'sessionId', 'status', ...['causeCode', 'upstreamStatus'].filter(k => Object.hasOwn(value ?? {}, k))])
    && UUID.test(value.turnId) && UUID.test(value.sessionId) && STAGES.includes(value.status)
    && (value.causeCode === undefined || CAUSES.has(value.causeCode))
    && (value.upstreamStatus === undefined || Number.isInteger(value.upstreamStatus) && value.upstreamStatus >= 100 && value.upstreamStatus <= 599);
}

export async function createPiTurnController(options) {
  if (!piKeys(options, ['binding', 'stateRoot', 'approvedCases', ...['activationId'].filter(k => Object.hasOwn(options, k))]) || !validatePiNativeBinding(options.binding)
    || piHash(options.stateRoot) !== options.binding.stateRootDigest || !validatePiApprovedCases(options.approvedCases)) piReject();
  const { stateRoot } = options, binding = structuredClone(options.binding), approvedCases = structuredClone(options.approvedCases);
  const activationId = options.activationId ?? null;
  if (activationId !== null && !UUID.test(activationId)) piReject();
  const bindingDigest = piHash(piBytes(binding)), scopeDigest = piHash(piBytes({ binding, approvedCases, activationId }));
  const dirs = new Map();
  async function checkRoots() {
    for (const name of ['', 'turns', 'attempts']) {
      const root = path.join(stateRoot, name), stat = await lstat(root, { bigint: true });
      if (await realpath(root) !== root || !stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777n) !== 0o700n
        || stat.uid !== BigInt(process.getuid()) || dirs.has(name) && !isDeepStrictEqual(dirs.get(name), piIdentity(stat))) piReject();
      dirs.set(name, piIdentity(stat));
    }
  }
  await checkRoots();
  let queue = Promise.resolve(), closed = false;
  const rows = new Map(), credentials = new Map(), succeeded = new Set();
  const exclusive = fn => { const result = queue.then(async () => { await checkRoots(); return fn(); }); queue = result.catch(() => {}); return result; };
  async function once(filePath, value) {
    const bytes = piBytes(value);
    try { await writeNativeChatFile({ filePath, bytes }); }
    catch (error) {
      if (error.code !== 'EEXIST' || !(await readPiPrivateFile(filePath)).bytes.equals(bytes)) throw error;
    }
  }
  async function closeScope(scope = scopeDigest) {
    if (scope === scopeDigest) closed = true;
    await once(path.join(stateRoot, 'attempts', `pi-batch-${scope.slice(7)}.closed.json`), { scopeDigest: scope, closed: true });
  }
  const closedPath = path.join(stateRoot, 'attempts', `pi-batch-${scopeDigest.slice(7)}.closed.json`);
  try {
    const value = JSON.parse((await readPiPrivateFile(closedPath)).bytes);
    if (!isDeepStrictEqual(value, { scopeDigest, closed: true })) piReject(); closed = true;
  } catch (error) { if (error.code !== 'ENOENT') throw error; }
  async function stage(row, status, details = {}) {
    const value = { schemaVersion: 'agentmo.pi-turn-state.v1', bindingDigest, scopeDigest: row.scopeDigest,
      sessionId: row.sessionId, turnId: row.turnId, status, ...details };
    await once(path.join(stateRoot, 'turns', `${row.turnId}.${status}.json`), value);
    Object.assign(row, { status, ...details });
    if (TERMINAL.has(status) && status !== 'completed') await closeScope(row.scopeDigest);
    return publicTurn(row);
  }
  const names = await readdir(path.join(stateRoot, 'turns'));
  if (names.length > 10000 || names.some(name => !/^([a-f0-9-]{36})\.(received|reserved|sent|completed|failed|interrupted)\.json$/u.test(name))) piReject();
  for (const name of names.filter(n => n.endsWith('.received.json'))) {
    const row = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'turns', name))).bytes);
    if (!piKeys(row, ['schemaVersion', 'bindingDigest', 'scopeDigest', 'caseId', 'sessionId', 'turnId', 'inputDigest', 'sequence', 'status'])
      || row.schemaVersion !== 'agentmo.pi-turn-state.v1' || row.bindingDigest !== bindingDigest || !DIGEST.test(row.scopeDigest)
      || !CASE.test(row.caseId) || !UUID.test(row.sessionId) || !UUID.test(row.turnId) || name !== `${row.turnId}.received.json`
      || !DIGEST.test(row.inputDigest) || !Number.isSafeInteger(row.sequence) || row.sequence < 0 || row.sequence >= 19 || row.status !== 'received') piReject();
    rows.set(row.turnId, row);
    const caseClaim = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'attempts',
      `pi-case-${row.scopeDigest.slice(7)}-${row.sequence}.json`))).bytes);
    if (!isDeepStrictEqual(caseClaim, row)) piReject();
  }
  const casePrefix = `pi-case-${scopeDigest.slice(7)}-`;
  for (const name of (await readdir(path.join(stateRoot, 'attempts'))).filter(n => n.startsWith(casePrefix))) {
    const sequence = Number(name.slice(casePrefix.length, -5));
    if (!Number.isInteger(sequence) || sequence < 0 || sequence >= approvedCases.length || name !== `${casePrefix}${sequence}.json`) piReject();
    const claim = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'attempts', name))).bytes);
    const row = rows.get(claim.turnId);
    if (!row) { await closeScope(); continue; }
    if (!isDeepStrictEqual(claim, row)) piReject();
  }
  for (const name of names.filter(n => !n.endsWith('.received.json'))) {
    const value = JSON.parse((await readPiPrivateFile(path.join(stateRoot, 'turns', name))).bytes), row = rows.get(name.slice(0, 36));
    const optional = ['causeCode', 'upstreamStatus', 'finalEntryId'].filter(k => Object.hasOwn(value, k));
    if (!row || !piKeys(value, ['schemaVersion', 'bindingDigest', 'scopeDigest', 'sessionId', 'turnId', 'status', ...optional])
      || value.schemaVersion !== row.schemaVersion || value.bindingDigest !== bindingDigest || value.scopeDigest !== row.scopeDigest
      || value.sessionId !== row.sessionId || value.turnId !== row.turnId || name !== `${row.turnId}.${value.status}.json`
      || !STAGES.includes(value.status) || value.causeCode !== undefined && !CAUSES.has(value.causeCode)
      || value.upstreamStatus !== undefined && (!Number.isInteger(value.upstreamStatus) || value.upstreamStatus < 100 || value.upstreamStatus > 599)
      || value.status === 'completed' && !/^[A-Za-z0-9_-]{1,128}$/u.test(value.finalEntryId ?? '')) piReject();
    row.observed ??= new Map(); row.observed.set(value.status, value);
  }
  for (const row of rows.values()) {
    const observed = row.observed ?? new Map(); delete row.observed;
    const terminal = [...TERMINAL].filter(s => observed.has(s));
    if (terminal.length > 1 || observed.has('sent') && !observed.has('reserved')
      || observed.has('completed') && !observed.has('sent')) piReject();
    if (terminal.length) Object.assign(row, observed.get(terminal[0]));
    else await stage(row, 'interrupted', { causeCode: 'PI_INTERRUPTED' });
  }
  const scopedRows = () => [...rows.values()].filter(row => row.scopeDigest === scopeDigest).sort((a, b) => a.sequence - b.sequence);
  for (const [i, row] of scopedRows().entries()) {
    if (row.sequence !== i || !isDeepStrictEqual({ caseId: row.caseId, sessionId: row.sessionId, inputDigest: row.inputDigest }, approvedCases[i])) piReject();
    if (row.status !== 'completed') closed = true;
  }
  const status = () => {
    const used = scopedRows(), active = [...rows.values()].some(row => !TERMINAL.has(row.status));
    const canSend = !closed && !active && used.length < approvedCases.length;
    return { canSend, nextCaseId: canSend ? approvedCases[used.length].caseId : null };
  };
  const controller = {
    status: () => exclusive(status),
    state: turnId => exclusive(() => { if (!UUID.test(turnId) || !rows.has(turnId)) fail(404); return publicTurn(rows.get(turnId)); }),
    admit: input => exclusive(async () => {
      if (!piKeys(input, ['caseId', 'sessionId', 'turnId', 'inputDigest']) || !UUID.test(input.turnId) || !UUID.test(input.sessionId)
        || !CASE.test(input.caseId) || !DIGEST.test(input.inputDigest)) fail();
      const old = rows.get(input.turnId);
      if (old) {
        if (old.sessionId !== input.sessionId || old.caseId !== input.caseId || old.inputDigest !== input.inputDigest || old.scopeDigest !== scopeDigest) fail(409);
        return { kind: 'existing', turn: publicTurn(old) };
      }
      const state = status(), sequence = scopedRows().length;
      if (!state.canSend || !isDeepStrictEqual(approvedCases[sequence], { caseId: input.caseId, sessionId: input.sessionId, inputDigest: input.inputDigest })) fail(409);
      const row = { schemaVersion: 'agentmo.pi-turn-state.v1', bindingDigest, scopeDigest, ...input, sequence, status: 'received' };
      try {
        await writeNativeChatFile({ filePath: path.join(stateRoot, 'attempts', `${casePrefix}${sequence}.json`), bytes: piBytes(row) });
      } catch (error) { if (error.code === 'EEXIST') fail(409); throw error; }
      try { await writeNativeChatFile({ filePath: path.join(stateRoot, 'turns', `${input.turnId}.received.json`), bytes: piBytes(row) }); }
      catch (error) { await closeScope().catch(() => {}); throw error; }
      rows.set(input.turnId, row);
      const turnToken = randomBytes(32).toString('hex'); credentials.set(turnToken, { row, used: false });
      return { kind: 'admitted', turnToken };
    }),
    finish: input => exclusive(async () => {
      const optional = ['finalEntryId', 'causeCode'].filter(k => Object.hasOwn(input ?? {}, k));
      if (!piKeys(input, ['sessionId', 'turnId', 'status', ...optional]) || !TERMINAL.has(input.status)
        || input.causeCode !== undefined && !CAUSES.has(input.causeCode)) fail();
      const row = rows.get(input.turnId);
      if (!row || row.sessionId !== input.sessionId) fail(409);
      if (TERMINAL.has(row.status)) return publicTurn(row);
      if (input.status === 'completed' && (!succeeded.has(row.turnId) || !/^[A-Za-z0-9_-]{1,128}$/u.test(input.finalEntryId ?? ''))) fail(409);
      return stage(row, input.status, input.status === 'completed' ? { finalEntryId: input.finalEntryId }
        : { causeCode: input.causeCode ?? (input.status === 'interrupted' ? 'PI_INTERRUPTED' : 'PI_SDK_FAILURE') });
    }),
  };
  controllers.set(controller, {
    binding,
    begin: (token, inputDigest, requestDigest) => exclusive(async () => {
      const credential = credentials.get(token); if (!credential) fail(401);
      if (credential.used) fail(409);
      const { row } = credential;
      if (closed || row.status !== 'received' || row.inputDigest !== inputDigest) fail();
      credential.used = true;
      const key = piHash(piBytes({ bindingDigest, scopeDigest, sessionId: row.sessionId, turnId: row.turnId, requestDigest }));
      await writeNativeChatFile({ filePath: path.join(stateRoot, 'attempts', `pi-${key.slice(7)}.claim`),
        bytes: piBytes({ bindingDigest, scopeDigest, sessionId: row.sessionId, turnId: row.turnId, requestDigest }) });
      return row;
    }),
    reserved: row => exclusive(() => stage(row, 'reserved')),
    sent: row => exclusive(() => stage(row, 'sent')),
    succeeded: row => exclusive(() => { if (row.status !== 'sent') fail(); succeeded.add(row.turnId); }),
    failure: (token, error) => exclusive(async () => {
      const row = credentials.get(token)?.row; if (!row) return;
      if (error.httpStatus === 409 || TERMINAL.has(row.status)) { await closeScope(row.scopeDigest); return; }
      const details = { causeCode: CAUSES.has(error.code) ? error.code : error.httpStatus ? 'PI_REQUEST_INVALID' : 'PI_LOCAL_FAILURE' };
      if (Number.isInteger(error.upstreamStatus) && error.upstreamStatus >= 100 && error.upstreamStatus <= 599) details.upstreamStatus = error.upstreamStatus;
      await stage(row, 'failed', details);
    }),
  });
  return controller;
}

export function createPiBudgetHandler(options) {
  if (!piKeys(options, ['binding', 'stateRoot', 'budgetRoot', 'apiKey', 'controller']) || !validatePiNativeBinding(options.binding)
    || !controllers.has(options.controller) || !isDeepStrictEqual(controllers.get(options.controller).binding, options.binding)
    || piHash(options.stateRoot) !== options.binding.stateRootDigest || typeof options.apiKey !== 'string' || !options.apiKey || /[\r\n]/u.test(options.apiKey)) piReject();
  const { budgetRoot, controller } = options, binding = structuredClone(options.binding), control = controllers.get(controller);
  const counts = { proxyRequests: 0, modelRequests: 0, newReservations: 0 }, pending = new Set();
  let apiKey = options.apiKey, closed = false;
  const handler = async (req, res) => {
    counts.proxyRequests++;
    const abort = new AbortController(), cancel = () => { if (!res.writableFinished) abort.abort(); };
    pending.add(abort);
    res.once('close', cancel); let phase = 'request';
    const timer = setTimeout(() => abort.abort(), 90000); timer.unref();
    const token = /^Bearer ([a-f0-9]{64})$/u.exec(req.headers.authorization ?? '')?.[1];
    try {
      if (closed || req.method !== 'POST' || req.url !== '/v1/chat/completions' || req.headers.host !== `127.0.0.1:${binding.proxyPort}`
        || req.headers['content-type']?.split(';')[0] !== 'application/json' || !token) fail();
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; if (length > 48 * 1024) fail(); chunks.push(Buffer.from(chunk)); }
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      const { request, requestDigest } = validateNativeChatRequest(value, binding.modelProfile);
      if (request.messages.some(m => !m.content.isWellFormed())) fail();
      await validateCourseBudgetBinding({ root: budgetRoot, budgetReference: binding.budgetReference });
      const row = await control.begin(token, piHash(request.messages.at(-1).content), requestDigest);
      phase = 'upstream';
      const result = await sendBudgetedCompletion({ root: budgetRoot, budgetReference: binding.budgetReference, apiKey,
        request, modelProfile: binding.modelProfile, deadline: Date.now() + 90000, signal: abort.signal,
        onReserved: () => { counts.newReservations++; return control.reserved(row); },
        onSent: () => { counts.modelRequests++; return control.sent(row); } });
      if (abort.signal.aborted) fail(502);
      await control.succeeded(row);
      res.writeHead(200, { 'content-type': result.contentType, 'cache-control': 'no-store', 'x-should-retry': 'false' }); res.end(result.body);
    } catch (error) {
      await control.failure(token, error).catch(() => {});
      const status = [401, 409].includes(error.httpStatus) ? error.httpStatus : phase === 'upstream' ? 502 : 400;
      if (!res.destroyed) { res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-should-retry': 'false' });
        res.end(JSON.stringify({ error: { code: status === 409 ? 'PI_DUPLICATE_OR_UNCERTAIN' : status === 502 ? 'PI_COMPLETION_FAILED' : 'PI_REQUEST_INVALID' } })); }
    } finally { clearTimeout(timer); res.off('close', cancel); pending.delete(abort); }
  };
  Object.defineProperties(handler, { summary: { value: () => ({ ...counts }) }, close: { value: () => {
    closed = true; apiKey = ''; for (const abort of pending) abort.abort();
  } } });
  return handler;
}

export async function startPiBudgetProxy(options) {
  const handler = createPiBudgetHandler(options), server = createServer(handler);
  server.headersTimeout = 10000; server.requestTimeout = 10000;
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.binding.proxyPort, '127.0.0.1', resolve); });
  let closed = false;
  return { port: options.binding.proxyPort, summary: handler.summary, close: async () => { if (closed) return; closed = true;
    handler.close();
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}
