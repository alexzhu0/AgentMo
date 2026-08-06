import { readFile } from "node:fs/promises";
import path from "node:path";
import { validateResearchCollectionState } from "./poc-research-collector.js";
import { mergeResearchDb, validateResearchDb } from "./poc-research-store.js";
import { writePersistableJsonAtomic, writePersistableProductTextAtomic, preparePersistableProductText } from "./persistability.js";

const RESEARCH_ROOT = "research";
const DB_FILENAME = "research-db.json";
const STATE_FILENAME = "collection-state.json";

export async function loadPocResearchWorkspace(workspace, agentId) {
  const root = path.resolve(workspace);
  const [db, state] = await Promise.all([
    readJson(path.join(root, RESEARCH_ROOT, DB_FILENAME)),
    readJson(path.join(root, RESEARCH_ROOT, STATE_FILENAME)),
  ]);
  if (!validateResearchDb(db).ok || db.agentId !== agentId
    || !validateResearchCollectionState(state, agentId).ok) {
    throw workspaceError("AGENTMO_POC_RESEARCH_WORKSPACE_INVALID");
  }
  return Object.freeze({ root, db, state });
}

export async function persistResearchCollection(workspace, collection) {
  if (!collection || typeof collection !== "object" || !Array.isArray(collection.records)
    || !collection.state || typeof collection.state !== "object") {
    throw workspaceError("AGENTMO_POC_RESEARCH_WORKSPACE_INVALID");
  }
  const loaded = await loadPocResearchWorkspace(workspace, collection.state.agentId);
  if (!validateResearchCollectionState(collection.state, loaded.db.agentId).ok) {
    throw workspaceError("AGENTMO_POC_RESEARCH_WORKSPACE_INVALID");
  }
  const db = mergeResearchDb({ previousDb: loaded.db, collection });
  const researchRoot = path.join(loaded.root, RESEARCH_ROOT);
  // DB first: a crash before state publication only re-fetches safely; it never
  // advances an ETag past records that were not durably admitted.
  await writePersistableJsonAtomic(path.join(researchRoot, DB_FILENAME), db, { subject: "poc-research-db" });
  await writePersistableJsonAtomic(path.join(researchRoot, STATE_FILENAME), collection.state, { subject: "poc-research-collection-state" });
  return Object.freeze({ recordCount: db.records.length, newlyAdmitted: db.records.length - loaded.db.records.length });
}

export async function persistResearchBrief(workspace, brief, markdown) {
  const root = path.resolve(workspace);
  if (brief?.schemaVersion !== "agentmo.poc-research-daily-brief.v1" || typeof brief.date !== "string" || typeof markdown !== "string") {
    throw workspaceError("AGENTMO_POC_RESEARCH_WORKSPACE_INVALID");
  }
  const directory = path.join(root, RESEARCH_ROOT, "daily-briefs");
  await writePersistableJsonAtomic(path.join(directory, `${brief.date}.json`), brief, { subject: "poc-research-daily-brief" });
  await writePersistableProductTextAtomic(path.join(directory, `${brief.date}.md`), preparePersistableProductText(markdown, { subject: "poc-research-daily-brief-markdown" }), { subject: "poc-research-daily-brief-markdown" });
  return Object.freeze({ date: brief.date, directory: "research/daily-briefs" });
}

async function readJson(filePath) {
  try { return JSON.parse(await readFile(filePath, "utf8")); } catch { throw workspaceError("AGENTMO_POC_RESEARCH_WORKSPACE_INVALID"); }
}

function workspaceError(code) {
  const error = new Error("AgentMo POC research workspace rejected the operation.");
  error.code = code;
  return error;
}
