import path from 'node:path';
import { lstat, realpath } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { isDeepStrictEqual } from 'node:util';
import { piHash, readPiPrivateFile } from './pi-install-plan.js';
import { preparePiCliRequest, runApprovedPiCliRequest, listPiCliSessions } from './pi-cli-run.js';

const refuse = () => { throw Object.assign(new Error('Pi CLI input refused.'), { code: 'AGENTMO_PI_CLI_INPUT_REJECTED' }); };
const deniedPart = part => /^\.env/iu.test(part) || ['.agentmo', '.superpowers', '.git', '.ssh', '.aws', '.codex', '.agents', 'node_modules', 'sessions', 'turns', 'attempts'].includes(part.toLowerCase())
  || /(?:^|[._-])(?:auth|credentials?|secrets?|tokens?|passwords?|passwd|api[-_]?keys?|keys?|private[-_]?key|login|control)(?:[._-]|$)/iu.test(part);
const identity = stat => Object.fromEntries(['dev', 'ino', 'birthtimeNs', 'size', 'mtimeNs', 'ctimeNs', 'nlink'].map(k => [k, String(stat[k])]));
const validText = text => typeof text === 'string' && text.trim() && text.isWellFormed() && [...text].length <= 8000;

async function textPath(sourceRoot, relativePath) {
  if (typeof sourceRoot !== 'string' || !path.isAbsolute(sourceRoot) || path.resolve(sourceRoot) !== sourceRoot
    || typeof relativePath !== 'string' || !relativePath || relativePath.includes('\\') || relativePath.includes('\0')
    || path.isAbsolute(relativePath) || relativePath.split('/').some(p => !p || p === '.' || p === '..' || deniedPart(p))
    || sourceRoot.split('/').some(deniedPart) || !/\.(txt|md)$/iu.test(relativePath)) refuse();
  const file = path.resolve(sourceRoot, relativePath);
  if (!file.startsWith(`${sourceRoot}${path.sep}`) || await realpath(sourceRoot) !== sourceRoot || await realpath(path.dirname(file)) !== path.dirname(file)) refuse();
  return file;
}
export async function readPiCliText({ sourceRoot, relativePath }) {
  const file = await textPath(sourceRoot, relativePath), before = await lstat(file, { bigint: true });
  const bytes = (await readPiPrivateFile(file, 32000, { privateMode: false })).bytes;
  const after = await lstat(file, { bigint: true });
  if (!isDeepStrictEqual(identity(before), identity(after))) refuse();
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { refuse(); }
  if (!validText(text)) refuse();
  return Object.freeze({ text, contentDigest: piHash(bytes), identity: Object.freeze(identity(after)) });
}
function terminalIo() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) refuse();
  const rl = createInterface({ input: process.stdin, output: process.stdout, crlfDelay: Infinity, terminal: true });
  const lines = rl[Symbol.asyncIterator]();
  return { isTTY: true, async readLine(prompt = '') { process.stdout.write(prompt); const next = await lines.next(); return next.done ? null : next.value; },
    onInterrupt: handler => rl.on('SIGINT', handler), write: text => process.stdout.write(text), close: () => rl.close() };
}
export async function runPiChatCli({ installed, sourceRoot, runtimeEnvFile, ports, io }) {
  let ownIo = false;
  if (!io) { io = terminalIo(); ownIo = true; }
  if (io.isTTY !== true) refuse();
  const abort = new AbortController(), stop = () => { abort.abort(); if (ownIo) io.close(); };
  if (ownIo) io.onInterrupt(stop);
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
  let sessionId = null;
  io.write(`Agent ${installed.sourceAdmissions.blueprint.value.agent_id} · Pi 1.2.0\n/sessions /use <id> /new /paste /file <relative.txt|md> /quit\n`);
  try {
    while (!abort.signal.aborted) {
      const line = await io.readLine('任务> ');
      if (line === null || line === '/quit') break;
      if (line === '/sessions') { io.write(`${JSON.stringify(await listPiCliSessions({ installed }))}\n`); continue; }
      if (line.startsWith('/use ')) {
        const id = line.slice(5);
        if (!(await listPiCliSessions({ installed })).some(s => s.id === id)) { io.write('未知会话，未切换。\n'); continue; }
        sessionId = id; io.write(`当前会话 ${id}\n`); continue;
      }
      let text = line, file, relativePath;
      const kind = line === '/new' ? 'create-session' : 'turn';
      if (kind === 'turn' && !sessionId) { io.write('先用 /new 创建会话或 /use 选择会话。\n'); continue; }
      if (line === '/paste') {
        const lines = [];
        while (true) {
          const next = await io.readLine('材料> ');
          if (next === null) return;
          if (next === '/end') break;
          lines.push(next === '//end' ? '/end' : next);
          if ([...lines.join('\n')].length > 8000) { io.write('超过8000码点，未发送并退出。\n'); return; }
        }
        text = lines.join('\n');
      } else if (line.startsWith('/file ')) {
        relativePath = line.slice(6);
        try { file = await readPiCliText({ sourceRoot, relativePath }); text = file.text; }
        catch { io.write('文件读取被拒绝，未发送。\n'); continue; }
      } else if (line.startsWith('/') && kind !== 'create-session') { io.write('未知命令，未发送。\n'); continue; }
      if (kind === 'turn' && !validText(text)) { io.write('需要非空且不超过8000码点的文字，未发送。\n'); continue; }
      const preview = await preparePiCliRequest({ installed, kind, ports,
        ...(kind === 'turn' ? { sessionId, text, runtimeEnvFile } : {}) });
      io.write(`本次预览 ${JSON.stringify(preview)}\n`);
      if (kind === 'turn') io.write(`发送范围：当前会话已保存历史和本条文字。原文（JSON转义展示）：${JSON.stringify(text)}\n`);
      const confirmation = await io.readLine(`确认本次操作请输入 ${preview.confirmationCode}；其他输入取消> `);
      if (confirmation === null || abort.signal.aborted) break;
      if (file) {
        try {
          const current = await lstat(await textPath(sourceRoot, relativePath), { bigint: true });
          if (!current.isFile() || !isDeepStrictEqual(identity(current), file.identity)) refuse();
        } catch { io.write('文件已变化，本次预览取消，未发送。\n'); continue; }
      }
      const result = await runApprovedPiCliRequest({ preview, confirmation, signal: abort.signal });
      if (result.status === 'declined') { io.write('已取消，未运行。\n'); continue; }
      if (!['created', 'completed'].includes(result.status) || result.cleanup?.status !== 'stopped') {
        const stopped = result.cleanup?.status === 'stopped' ? '自有服务已停止' : result.cleanup?.status === 'not-started' ? '服务未启动' : '停止未确认';
        io.write(`请求失败，${stopped}，不重试。${result.failureCode ?? 'AGENTMO_PI_CLI_REQUEST_FAILED'}；新增预留 ${result.newReservedFen ?? '未知'}分\n`);
        throw Object.assign(new Error('Pi CLI operation failed.'), { code: 'AGENTMO_PI_CLI_REQUEST_FAILED' });
      }
      if (result.status === 'created') { sessionId = result.sessionId; io.write(`新会话 ${sessionId}\n`); }
      else if (result.status === 'completed') io.write(`回复：${JSON.stringify(result.replyText)}\n本次新增预留 ${result.newReservedFen}分\n`);
    }
  } finally { abort.abort(); process.off('SIGINT', stop); process.off('SIGTERM', stop); if (ownIo) io.close(); }
}
