import { codexBuilderAdapter } from "./codex.js";

const ADAPTERS = Object.freeze([codexBuilderAdapter]);
const ADAPTER_BY_ID = new Map(ADAPTERS.map((adapter) => [adapter.id, adapter]));

export function listBuilderAdapters() {
  return ADAPTERS.map((adapter) => ({
    id: adapter.id,
    label: adapter.label,
    contractVersion: adapter.contractVersion,
    supportDeclaration: adapter.supportDeclaration,
    supportClaim: false,
  }));
}

export function listBuilderAdapterIds() {
  return ADAPTERS.map((adapter) => adapter.id);
}

export function getBuilderAdapter(adapterId) {
  return ADAPTER_BY_ID.get(adapterId);
}

export function assertBuilderAdapter(adapterId) {
  const adapter = getBuilderAdapter(adapterId);
  if (!adapter) {
    const error = new Error(`Unknown builder adapter: ${adapterId}`);
    error.code = "AGENTMO_CLI_BUILDER_REJECTED";
    throw error;
  }
  return adapter;
}
