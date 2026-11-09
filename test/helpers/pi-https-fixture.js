import https from 'node:https';
import { createPiConformanceHttpsRequest } from '../../scripts/pi-sdk-conformance.js';

// Every test importing this fixture refuses an unstubbed external request.
https.request = () => { throw new Error('Unstubbed HTTPS forbidden in offline tests'); };
export function stubPiUpstream(t, handler) {
  const previous = https.request;
  https.request = createPiConformanceHttpsRequest(handler);
  t.after(() => { https.request = previous; });
}
