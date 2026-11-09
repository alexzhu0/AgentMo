import https from 'node:https';
import { Readable } from 'node:stream';

export function postPiMessages({ body, apiKey, signal }) {
  return new Promise((resolve, reject) => {
    if (typeof body !== 'string' || typeof apiKey !== 'string' || !apiKey || /[\r\n]/u.test(apiKey) || signal?.aborted) {
      reject(new Error('Pi upstream request refused.')); return;
    }
    let incoming;
    const abortError = () => new DOMException('Request aborted', 'AbortError');
    const cancel = () => { incoming?.destroy(abortError()); request.destroy(abortError()); };
    const cleanup = () => signal?.removeEventListener('abort', cancel);
    const request = https.request(new URL('https://api.minimax.cn/anthropic/v1/messages'), {
      method: 'POST', agent: false, rejectUnauthorized: true, signal,
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json',
        'content-length': Buffer.byteLength(body) },
    }, response => {
      incoming = response;
      response.once('close', cleanup);
      try {
        const status = response.statusCode;
        const headers = {};
        if (typeof response.headers['content-type'] === 'string') headers['content-type'] = response.headers['content-type'];
        const noBody = [204, 205, 304].includes(status);
        if (noBody) response.resume();
        resolve(new Response(noBody ? null : Readable.toWeb(response), { status, headers }));
      } catch (error) { response.destroy(); cleanup(); reject(error); }
    });
    request.on('error', error => { incoming?.destroy(error); cleanup(); reject(error); });
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel(); else request.end(body);
  });
}
