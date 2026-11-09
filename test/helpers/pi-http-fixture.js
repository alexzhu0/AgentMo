import { Readable, Writable } from 'node:stream';
export const piNativeRequest = text => ({ model: 'MiniMax-M3', messages: [{ role: 'user', content: text }],
  stream: true, max_tokens: 2048, thinking: { type: 'disabled' } });
export function piNativeResponse() {
  const events = [
    { type: 'message_start', message: { id: 'synthetic', type: 'message', role: 'assistant', model: 'MiniMax-M3',
      content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 20, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Synthetic final reply' } },
    { type: 'content_block_stop', index: 0 },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 3 } },
    { type: 'message_stop' },
  ];
  return new Response(events.map(e => `event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`).join(''),
    { headers: { 'content-type': 'text/event-stream' } });
}
class Reply extends Writable {
  chunks = []; headers = {}; statusCode = 200;
  _write(chunk, encoding, callback) { this.chunks.push(Buffer.from(chunk)); callback(); }
  writeHead(status, headers) { this.statusCode = status; this.headers = headers; return this; }
  text() { return Buffer.concat(this.chunks).toString('utf8'); }
  json() { return JSON.parse(this.text()); }
}
export async function piHttpRequest(handler, body, headers = {}, url = '/v1/messages?beta=true') {
  const req = Readable.from([Buffer.isBuffer(body) ? body : Buffer.from(JSON.stringify(body))]);
  Object.assign(req, { method: 'POST', url, headers: { host: '127.0.0.1:19493',
    'content-type': 'application/json', ...headers }, socket: { remoteAddress: '127.0.0.1' } });
  const response = new Reply(); await handler(req, response); return response;
}
