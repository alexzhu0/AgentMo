import { buildTargetFiles } from "../scaffold-files.js";
import { fileMapToWriteOperations } from "./operations.js";

export const openClawTarget = {
  id: "openclaw",
  label: "OpenClaw workspace scaffold",
  runtimeId: "openclaw",
  verificationHints: [
    "node ./bin/agentmo.js scaffold <blueprint> --target openclaw --out <dir>",
    "openclaw agents add <agent_id> --workspace <dir>/openclaw/workspace --non-interactive",
  ],
  unsupportedSurfaces: ["Runtime certification is not implied by scaffold generation."],
  supports: () => true,
  planOperations(blueprint, context) {
    return fileMapToWriteOperations(buildTargetFiles(blueprint, "openclaw", context.outputDir), context, "generated:openclaw-scaffold");
  },
};
