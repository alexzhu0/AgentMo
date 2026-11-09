import http from 'node:http';
import path from 'node:path';
import { piHash, readPiPrivateFile } from './pi-install-plan.js';
import { validatePiPublicTurn } from './pi-budget-proxy.js';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u;
const refuse = () => { throw Object.assign(new Error('Pi CLI request refused; no automatic retry.'), { code: 'AGENTMO_PI_CLI_REJECTED' }); };

export async function connectPiCli({ accessFile, port, mode, caseSpec }) {
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !['turn', 'create-session'].includes(mode)
    || !path.isAbsolute(accessFile) || !/^pi-run-[a-f0-9]{64}-\d+\.login\.txt$/u.test(path.basename(accessFile))
    || mode === 'create-session' && caseSpec !== null
    || mode === 'turn' && (!UUID.test(caseSpec?.sessionId) || !/^[a-z][a-z0-9-]{0,63}$/u.test(caseSpec?.caseId)
      || !/^sha256:[a-f0-9]{64}$/u.test(caseSpec?.inputDigest))) refuse();
  let secret = (await readPiPrivateFile(accessFile, 256)).bytes.toString('utf8');
  if (!/^[a-f0-9]{48}$/u.test(secret)) refuse();
  const scope = caseSpec && { ...caseSpec }, origin = `http://127.0.0.1:${port}`, abort = new AbortController();
  let cookie = '', attempted = false, closed = false;
  async function request(method, route, input) {
    if (closed) refuse();
    const wire = input === undefined ? undefined : JSON.stringify(input);
    const headers = { origin, ...(cookie ? { cookie } : {}), ...(wire === undefined ? {} : {
      'content-type': 'application/json', 'content-length': Buffer.byteLength(wire) }) };
    try {
      return await new Promise((resolve, reject) => {
        const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(90000)]);
        const req = http.request(new URL(route, origin), { method, headers, agent: false, signal }, res => {
          const chunks = []; let size = 0;
          res.on('data', chunk => {
            size += chunk.length;
            if (size > 1024 * 1024) { res.destroy(); reject(new Error('limit')); }
            else chunks.push(Buffer.from(chunk));
          });
          res.once('error', reject);
          res.once('end', () => {
            try {
              if (res.statusCode < 200 || res.statusCode >= 300) return reject(new Error('status'));
              resolve({ text: new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)), headers: res.headers });
            } catch (error) { reject(error); }
          });
        });
        req.once('error', reject); req.end(wire);
      });
    } catch { refuse(); }
  }
  const json = async (method, route, input) => {
    const result = await request(method, route, input);
    try { return JSON.parse(result.text); } catch { refuse(); }
  };
  try {
    const login = await request('POST', '/api/login', { password: secret });
    const header = login.headers['set-cookie'];
    const value = Array.isArray(header) ? header[0] : header;
    cookie = /^agentmo_pi_session=[a-f0-9]{64}(?=;|$)/u.exec(value ?? '')?.[0] ?? '';
    if (!cookie || JSON.parse(login.text).authenticated !== true) refuse();
  } finally { secret = ''; }
  return {
    async listSessions() {
      const value = await json('GET', '/api/sessions');
      if (!Array.isArray(value.sessions) || value.sessions.some(s => !UUID.test(s.id) || !Number.isFinite(Date.parse(s.createdAt)))) refuse();
      return value.sessions;
    },
    async createSession() {
      if (mode !== 'create-session' || attempted) refuse(); attempted = true;
      const value = await json('POST', '/api/sessions', {});
      if (!UUID.test(value.id)) refuse(); return { id: value.id };
    },
    async submit({ caseId, sessionId, turnId, text }) {
      if (mode !== 'turn' || attempted || caseId !== scope.caseId || sessionId !== scope.sessionId || !UUID.test(turnId)
        || typeof text !== 'string' || !text.trim() || !text.isWellFormed() || [...text].length > 8000 || piHash(text) !== scope.inputDigest) refuse();
      attempted = true;
      const initial = await json('POST', '/api/turns', { caseId, sessionId, turnId, text });
      if (!validatePiPublicTurn(initial) || initial.turnId !== turnId || initial.sessionId !== sessionId
        || ['failed', 'interrupted'].includes(initial.status)) refuse();
      const result = await request('GET', `/api/turns/${turnId}/events`);
      if (result.headers['content-type']?.split(';')[0] !== 'text/event-stream') refuse();
      let completed;
      for (const line of result.text.split(/\r?\n/u).filter(s => s.startsWith('data: '))) {
        let event;
        try { event = JSON.parse(line.slice(6)); } catch { refuse(); }
        const { text: replyText, ...state } = event;
        if (!validatePiPublicTurn(state) || state.turnId !== turnId || state.sessionId !== sessionId || completed) refuse();
        if (['failed', 'interrupted'].includes(state.status)) {
          throw Object.assign(new Error('Pi request failed; no automatic retry.'), { code: state.causeCode ?? 'AGENTMO_PI_CLI_REQUEST_FAILED',
            ...state.upstreamStatus === undefined ? {} : { upstreamStatus: state.upstreamStatus },
            ...state.upstreamNetworkCode === undefined ? {} : { upstreamNetworkCode: state.upstreamNetworkCode } });
        }
        if (state.status === 'completed') {
          if (typeof replyText !== 'string' || !replyText.trim() || !replyText.isWellFormed() || Buffer.byteLength(replyText) > 128 * 1024) refuse();
          completed = { sessionId, turnId, status: 'completed', replyText, replyDigest: piHash(replyText) };
        } else if (replyText !== undefined) refuse();
      }
      if (!completed) refuse(); return completed;
    },
    async close() { closed = true; cookie = ''; abort.abort(); },
  };
}
