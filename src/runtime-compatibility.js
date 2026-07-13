export const AGENTMO_CORE_NODE_RANGE = ">=20";
export const OPENCLAW_TARGET_NODE_RANGE = ">=22.19.0 <23 || >=23.11.0";

const OPENCLAW_TARGET_COMPONENT = "openclaw-target";
const OPENCLAW_TARGET_ID = "openclaw";
const CURRENT_PROCESS_EVIDENCE_CLASS = "current-process";
const NUMERIC_TRIPLET_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/u;

export function isOpenClawTargetNodeSupported(version) {
  const triplet = parseNumericTriplet(version);
  if (triplet === null) return false;
  const [major, minor] = triplet;
  if (major === 22) return minor >= 19;
  if (major === 23) return minor >= 11;
  return major >= 24;
}

export function observeCurrentRuntime() {
  return buildCurrentRuntimeObservation(process.versions.node);
}

export function assertCurrentOpenClawTargetRuntime() {
  if (arguments.length !== 0) {
    const error = new Error("Runtime authorization accepts no caller-supplied inputs.");
    error.code = "AGENTMO_OPENCLAW_RUNTIME_INPUT_REJECTED";
    throw error;
  }
  const observation = buildCurrentRuntimeObservation(process.versions.node);
  if (!observation.supported) {
    const error = new Error("Current process does not satisfy the OpenClaw target runtime range.");
    error.code = "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED";
    throw error;
  }
  return observation;
}

function parseNumericTriplet(version) {
  if (typeof version !== "string") return null;
  const match = NUMERIC_TRIPLET_PATTERN.exec(version);
  if (match === null) return null;
  const triplet = match.slice(1).map(Number);
  return triplet.every((part) => Number.isSafeInteger(part)) ? triplet : null;
}

function buildCurrentRuntimeObservation(observedVersion) {
  return Object.freeze({
    component: OPENCLAW_TARGET_COMPONENT,
    target: OPENCLAW_TARGET_ID,
    observedVersion,
    range: OPENCLAW_TARGET_NODE_RANGE,
    supported: isOpenClawTargetNodeSupported(observedVersion),
    evidenceClass: CURRENT_PROCESS_EVIDENCE_CLASS,
  });
}
