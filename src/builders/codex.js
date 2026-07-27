import {
  BUILDER_ADAPTER_CONTRACT_VERSION,
  BUILDER_REQUIRED_LIFECYCLE_EVENTS,
  defineBuilderAdapter,
} from "./contract.js";

export const codexBuilderAdapter = defineBuilderAdapter({
  contractVersion: BUILDER_ADAPTER_CONTRACT_VERSION,
  id: "codex",
  label: "OpenAI Codex",
  supportDeclaration: "candidate",
  supportClaim: false,
  capabilities: [
    {
      id: "codex-cli",
      requirement: "required",
      description: "A bounded Codex CLI version surface is available.",
      probe: { kind: "version" },
      fallback: null,
    },
    {
      id: "plugin-distribution",
      requirement: "required",
      description: "Codex plugins are enabled and the plugin command is visible.",
      probe: { kind: "feature-and-help", feature: "plugins", command: "plugin-help" },
      fallback: null,
    },
    {
      id: "native-hooks",
      requirement: "required",
      description: "The current canonical hooks feature is enabled.",
      probe: { kind: "feature", feature: "hooks" },
      fallback: null,
    },
    {
      id: "session-resume",
      requirement: "required",
      description: "A session resume command is visible for host-level continuation.",
      probe: { kind: "help", command: "resume-help" },
      fallback: null,
    },
    {
      id: "host-doctor",
      requirement: "optional",
      description: "The host exposes its own read-only doctor command.",
      probe: { kind: "help", command: "doctor-help" },
      fallback: {
        status: "disabled",
        tested: true,
        impact: "AgentMo doctor remains independent and does not invoke an unavailable host doctor.",
      },
    },
  ],
  lifecycleEvents: [...BUILDER_REQUIRED_LIFECYCLE_EVENTS],
  contextInjection: {
    authority: "agentmo-artifacts",
    surfaces: ["plugin-skill", "project-agent", "hook-announcement"],
  },
  recovery: {
    authority: "agentmo-checkpoint",
    compaction: "artifact-first",
    restart: "artifact-first",
  },
  deduplication: {
    strategy: "event-id-ledger",
    key: "workflow-id:event-id",
  },
  unsupportedSurfaces: [
    "automatic human approval",
    "transcript-authoritative recovery",
    "background upgrade",
  ],
  degradedSurfaces: ["host doctor is optional because AgentMo doctor owns Builder diagnostics"],
  evidence: {
    maximum: "verified-behavior",
    supportClaim: false,
    domainQualityCertified: false,
  },
});
