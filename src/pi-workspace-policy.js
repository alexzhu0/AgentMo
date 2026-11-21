import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { assertPersistable, serializePersistableJson } from './persistability.js';

export const PI_WORKSPACE_LIMITS = Object.freeze({ maxRequests: 6, maxTools: 8, maxWrites: 1,
  maxTaskCodePoints: 8000, maxWireBytes: 49152, maxMessages: 32, maxOutputTokens: 2048,
  taskMs: 600000, requestMs: 90000, cleanupMs: 300000, retries: 0, restarts: 0,
  reservationFen: 31, maxReservedFen: 186 });
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v)
  && Object.keys(v).sort().join(',') === [...keys].sort().join(',');
const hash = s => 'sha256:' + createHash('sha256').update(s).digest('hex');
export function validatePiWorkspace(v) {
  const errors = [];
  try {
    assertPersistable(v);
    if (!exact(v, ['schemaVersion','inputPolicy','skill','outputPolicy','limits'])
      || v.schemaVersion !== 'agentmo.pi-workspace.v1'
      || !isDeepStrictEqual(v.inputPolicy, { extensions: ['txt','md'], maxFiles: 2, maxFileBytes: 4096, maxTotalBytes: 8192 })
      || !isDeepStrictEqual(v.outputPolicy, { fileName: 'report.md', format: 'markdown', maxBytes: 8192, overwrite: false })
      || !isDeepStrictEqual(v.limits, PI_WORKSPACE_LIMITS)) throw Error();
    const s = v.skill;
    if (!exact(s, ['name','description','body','digest']) || !/^[a-z][a-z0-9-]{0,63}$/u.test(s.name)
      || typeof s.description !== 'string' || !s.description.trim() || [...s.description].length > 256 || /[\r\n]/u.test(s.description)
      || typeof s.body !== 'string' || !s.body.isWellFormed() || Buffer.byteLength(s.body) > 4096
      || s.digest !== hash(s.body)) throw Error();
    // A single text-only skill; no extensible frontmatter or attached code/resources.
    const header = `---\nname: ${s.name}\ndescription: ${s.description}\n---\n`;
    if (!s.body.startsWith(header) || !s.body.slice(header.length).trim()
      || /```|<script|!\[|\]\([^)]*\)/iu.test(s.body)) throw Error();
  } catch { errors.push('pi_workspace must be an exact bounded text-only Pi workspace policy.'); }
  return { ok: errors.length === 0, errors };
}
export function piWorkspaceDigest(value) {
  if (!validatePiWorkspace(value).ok) throw Error('AGENTMO_PI_WORKSPACE_REJECTED');
  return hash(serializePersistableJson(value, { subject: 'pi-workspace' }));
}
export function validatePiWorkspaceSource(value) {
  if (!Object.hasOwn(value, 'pi_workspace')) return [];
  if (value.execution_profile !== 'native-chat' || value.native_runtime !== 'pi'
    || (value.native_model_profile ?? value.specification?.runtimeBinding?.modelProfile) !== 'minimax-m3-cn-v1')
    return ['pi_workspace requires the explicit Pi native-chat M3 profile.'];
  return validatePiWorkspace(value.pi_workspace).errors;
}
