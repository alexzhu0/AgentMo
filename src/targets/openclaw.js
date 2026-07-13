import { buildTargetFiles } from "../scaffold-files.js";
import { OPENCLAW_TARGET_NODE_RANGE } from "../runtime-compatibility.js";
import { fileMapToWriteOperations } from "./operations.js";

export const openClawTarget = {
  id: "openclaw",
  label: "OpenClaw workspace scaffold",
  runtimeId: "openclaw",
  verificationHints: [
    `OpenClaw target Node.js ${OPENCLAW_TARGET_NODE_RANGE}: node ./bin/agentmo.js runtime-check --target openclaw`,
    "node ./bin/agentmo.js runtime-check --target openclaw && node ./bin/agentmo.js scaffold <blueprint> --target openclaw --out <dir>",
    "node ./bin/agentmo.js runtime-check --target openclaw && openclaw agents add <agent_id> --workspace <dir>/openclaw/workspace --non-interactive",
  ],
  unsupportedSurfaces: ["Runtime certification is not implied by scaffold generation."],
  supports: () => true,
  planOperations(blueprint, context) {
    return fileMapToWriteOperations(buildTargetFiles(blueprint, "openclaw", context.outputDir), context, "generated:openclaw-scaffold");
  },
};
