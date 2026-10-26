import { isDeepStrictEqual } from 'node:util';
import { validatePiInstallPlan, piKeys, piReject } from './pi-install-plan.js';
import { assertPersistable } from './persistability.js';

const date = v => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/u.test(v) && Number.isFinite(Date.parse(v));
const extras = { 'install-approval': [], 'sensitive-action-decision': ['action'], 'conflict-approval': ['conflicts'] };
function validate(kind, value, context = {}) {
  try {
    const { plan } = context, fields = extras[kind];
    if (!validatePiInstallPlan(plan).ok || !piKeys(value, ['schemaVersion', 'decision', 'installPlanDigest', 'archiveBinding', 'authorityRootBinding',
      'lifecycle', ...fields, 'issuedAt', 'expiresAt', 'useNonce'])
      || value.schemaVersion !== `agentmo.pi-${kind}.v1` || value.decision !== 'approve'
      || value.installPlanDigest !== plan.installPlanDigest || value.lifecycle !== plan.lifecycle
      || !isDeepStrictEqual(value.archiveBinding, plan.archiveBinding) || !isDeepStrictEqual(value.authorityRootBinding, plan.authorityRootBinding)
      || !date(value.issuedAt) || !date(value.expiresAt) || !date(context.now)
      || Date.parse(value.issuedAt) > Date.parse(context.now) || Date.parse(value.expiresAt) <= Date.parse(context.now)
      || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/u.test(value.useNonce ?? '')
      || (kind === 'sensitive-action-decision' && (!isDeepStrictEqual(value.action, context.action)
        || !plan.sensitiveActions.some(a => isDeepStrictEqual(a, value.action))))
      || (kind === 'conflict-approval' && !isDeepStrictEqual(value.conflicts, plan.conflicts))) piReject();
    assertPersistable(value, { subject: `pi-${kind}` });
    return { ok: true, errors: [] };
  } catch { return { ok: false, errors: ['Exact unexpired Pi decision required.'] }; }
}
function build(kind, options) {
  const fields = extras[kind];
  if (!piKeys(options, ['plan', ...fields, 'decision', 'issuedAt', 'expiresAt', 'useNonce'])) piReject();
  const { plan } = options;
  const value = { schemaVersion: `agentmo.pi-${kind}.v1`, decision: options.decision, installPlanDigest: plan.installPlanDigest,
    archiveBinding: structuredClone(plan.archiveBinding), authorityRootBinding: structuredClone(plan.authorityRootBinding), lifecycle: plan.lifecycle,
    ...Object.fromEntries(fields.map(k => [k, structuredClone(options[k])])), issuedAt: options.issuedAt,
    expiresAt: options.expiresAt, useNonce: options.useNonce };
  if (!validate(kind, value, { plan, now: new Date().toISOString(), ...(kind === 'sensitive-action-decision' ? { action: options.action } : {}) }).ok) piReject();
  return value;
}
export const buildPiInstallApproval = options => build('install-approval', options);
export const buildPiSensitiveActionDecision = options => build('sensitive-action-decision', options);
export const buildPiConflictApproval = options => build('conflict-approval', options);
export const validatePiInstallApproval = (value, context) => validate('install-approval', value, context);
export const validatePiSensitiveActionDecision = (value, context) => validate('sensitive-action-decision', value, context);
export const validatePiConflictApproval = (value, context) => validate('conflict-approval', value, context);
