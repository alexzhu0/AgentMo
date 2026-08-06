import { POC_RESEARCH_DB_SCHEMA_VERSION, validateResearchRecord } from "./poc-research-contract.js";

export function createEmptyResearchDb(agentId) {
  return Object.freeze({
    schemaVersion: POC_RESEARCH_DB_SCHEMA_VERSION,
    agentId: requireAgentId(agentId),
    records: Object.freeze([]),
    sourceIndex: Object.freeze([]),
    entityIndex: Object.freeze([]),
    scenarioIndex: Object.freeze([]),
  });
}

export function validateResearchDb(value) {
  try {
    normalizeDb(value);
    return Object.freeze({ ok: true, errors: Object.freeze([]) });
  } catch {
    return Object.freeze({ ok: false, errors: Object.freeze(["Research DB shape is invalid."]) });
  }
}

export function mergeResearchDb({ previousDb, collection }) {
  const base = normalizeDb(previousDb);
  const incoming = Array.isArray(collection?.records) ? collection.records : null;
  if (incoming === null) throw storeError("AGENTMO_POC_RESEARCH_STORE_INVALID");

  const records = [...base.records];
  const knownUrls = new Set(records.map((record) => record.url));
  const knownDigests = new Set(records.map((record) => record.contentDigest));
  const knownIds = new Set(records.map((record) => record.id));
  for (const record of incoming) {
    if (!validateResearchRecord(record).ok || knownIds.has(record.id)
      || knownUrls.has(record.url) || knownDigests.has(record.contentDigest)) continue;
    records.push(cloneRecord(record));
    knownIds.add(record.id);
    knownUrls.add(record.url);
    knownDigests.add(record.contentDigest);
  }

  return deepFreeze({
    schemaVersion: POC_RESEARCH_DB_SCHEMA_VERSION,
    agentId: base.agentId,
    records,
    sourceIndex: buildIndex(records, "sourceId", "sourceId"),
    entityIndex: [],
    scenarioIndex: buildScenarioIndex(records),
  });
}

function normalizeDb(value) {
  if (value?.schemaVersion !== POC_RESEARCH_DB_SCHEMA_VERSION || !isSafeId(value.agentId)
    || !hasExactKeys(value, ["schemaVersion", "agentId", "records", "sourceIndex", "entityIndex", "scenarioIndex"])
    || !Array.isArray(value.records) || !Array.isArray(value.sourceIndex)
    || !Array.isArray(value.entityIndex) || !Array.isArray(value.scenarioIndex)) {
    throw storeError("AGENTMO_POC_RESEARCH_STORE_INVALID");
  }
  const seenIds = new Set();
  const seenUrls = new Set();
  const seenDigests = new Set();
  for (const record of value.records) {
    if (!validateResearchRecord(record).ok) throw storeError("AGENTMO_POC_RESEARCH_STORE_INVALID");
    if (seenIds.has(record.id) || seenUrls.has(record.url) || seenDigests.has(record.contentDigest)) {
      throw storeError("AGENTMO_POC_RESEARCH_STORE_INVALID");
    }
    seenIds.add(record.id);
    seenUrls.add(record.url);
    seenDigests.add(record.contentDigest);
  }
  if (JSON.stringify(value.sourceIndex) !== JSON.stringify(buildIndex(value.records, "sourceId", "sourceId"))
    || JSON.stringify(value.entityIndex) !== "[]"
    || JSON.stringify(value.scenarioIndex) !== JSON.stringify(buildScenarioIndex(value.records))) {
    throw storeError("AGENTMO_POC_RESEARCH_STORE_INVALID");
  }
  return { agentId: value.agentId, records: value.records };
}

function hasExactKeys(value, keys) {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function buildIndex(records, field, key) {
  const groups = new Map();
  for (const record of records) {
    const value = record[field];
    const entries = groups.get(value) ?? [];
    entries.push(record.id);
    groups.set(value, entries);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([value, recordIds]) => ({ [key]: value, recordIds }));
}

function buildScenarioIndex(records) {
  const groups = new Map();
  for (const record of records) {
    for (const scenario of record.scenarios) {
      const entries = groups.get(scenario) ?? [];
      entries.push(record.id);
      groups.set(scenario, entries);
    }
  }
  return [...groups.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([scenario, recordIds]) => ({ scenario, recordIds }));
}

function cloneRecord(record) {
  return {
    ...record,
    domains: [...record.domains],
    scenarios: [...record.scenarios],
    evidenceIds: [...record.evidenceIds],
  };
}

function requireAgentId(value) {
  if (!isSafeId(value)) throw storeError("AGENTMO_POC_RESEARCH_STORE_INVALID");
  return value;
}

function isSafeId(value) {
  return typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,127}$/u.test(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

function storeError(code) {
  const error = new Error("AgentMo POC Research DB store rejected the candidate.");
  error.code = code;
  return error;
}
