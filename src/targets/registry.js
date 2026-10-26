import { agentMoTarget } from "./agentmo.js";
import { openClawTarget } from "./openclaw.js";
import { piTarget } from "./pi.js";

const TARGETS = [agentMoTarget, openClawTarget, piTarget];
const TARGET_BY_ID = new Map(TARGETS.map((target) => [target.id, target]));

export function listTargets() {
  return TARGETS.map((target) => ({
    id: target.id,
    label: target.label,
    verificationHints: target.verificationHints ?? [],
    unsupportedSurfaces: target.unsupportedSurfaces ?? [],
  }));
}

export function listTargetIds() {
  return TARGETS.map((target) => target.id);
}

export function getTargetAdapter(targetId) {
  return TARGET_BY_ID.get(targetId);
}

export function assertTargetAdapter(targetId, subject = "target") {
  const target = getTargetAdapter(targetId);
  if (!target) {
    throw new Error(`Unknown ${subject}: ${targetId}. Expected one of: ${listTargetIds().join(", ")}`);
  }
  return target;
}
