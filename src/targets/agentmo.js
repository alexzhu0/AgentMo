import { buildBaseFiles } from "../scaffold-files.js";
import { fileMapToWriteOperations } from "./operations.js";

export const agentMoTarget = {
  id: "agentmo",
  label: "AgentMo domain-agent harness",
  runtimeId: (blueprint) => blueprint.runtime,
  verificationHints: ["node ./bin/agentmo.js scaffold <blueprint> --out <dir>", "npm run check"],
  unsupportedSurfaces: [],
  supports: () => true,
  planOperations(blueprint, context) {
    return fileMapToWriteOperations(buildBaseFiles(blueprint), context, "generated:agentmo-scaffold");
  },
};
