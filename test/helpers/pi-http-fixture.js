import { Readable, Writable } from 'node:stream';
class Reply extends Writable {
  chunks = []; headers = {}; statusCode = 200;
  _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; return this; }
  text() { return Buffer.concat(this.chunks).toString('utf8'); }
  json() { return JSON.parse(this.text()); }
}
export async function piHttpRequest(handler, body, headers = {}) {
  const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', url: '/v1/chat/completions', headers: { host: '127.0.0.1:19493',
    'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const response = new Reply(); await handler(req, response); return response;
}
