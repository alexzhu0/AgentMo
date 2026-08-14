import {
  DECISION_ENTRY_KINDS,
  DECISION_ENTRY_SCHEMA_VERSION,
} from "./decision-ledger.js";
import {
  AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY,
  AGENT_IDEA_CANDIDATE_ID_PATTERN_SOURCE,
  AGENT_IDEA_CANDIDATE_LIMITS,
  AGENT_IDEA_CANDIDATE_SCHEMA_VERSION,
  AGENT_IDEA_CANDIDATE_TEXT_PATTERN_SOURCE,
} from "./agent-idea-candidate.js";
import { createHash } from "node:crypto";
import { AGENT_PACKAGE_SCHEMA_VERSION } from "./package-contract.js";
import { OPENCLAW_PROBE_SCHEMA_VERSION } from "./openclaw-probe-contract.js";
import {
  OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
  OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
} from "./openclaw-install-receipt.js";
import {
  OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
  OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
  OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
} from "./openclaw-install-evidence.js";
import {
  OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
  OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
  buildOpenClawInstallPlan,
} from "./openclaw-install-plan.js";
import {
  OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
  OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
  OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
  buildOpenClawConflictApproval,
  buildOpenClawInstallApproval,
  buildOpenClawSensitiveActionDecision,
} from "./openclaw-install-approval.js";
import {
  buildOpenClawAuthorityRootBinding,
} from "./openclaw-authority-root-binding.js";

const NON_EMPTY_STRING = Object.freeze({ type: "string", minLength: 1 });
const NON_EMPTY_STRING_ARRAY = Object.freeze({
  type: "array",
  items: NON_EMPTY_STRING,
});
const DECISION_REF = Object.freeze({
  type: "string",
  pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$",
});
const DECISION_REF_ARRAY = Object.freeze({
  type: "array",
  maxItems: 128,
  uniqueItems: true,
  items: DECISION_REF,
});

const AGENT_IDEA_CANDIDATE_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "agent-idea-candidate",
  identity: AGENT_IDEA_CANDIDATE_SCHEMA_VERSION,
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo Agent Idea Candidate",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "ideaId",
      "title",
      "targetUsers",
      "candidateTasks",
      "valueHypothesis",
      "source",
      "evidenceIds",
      "evidenceGaps",
      "judgmentBoundaries",
      "certificationBoundary",
    ],
    properties: {
      schemaVersion: { const: AGENT_IDEA_CANDIDATE_SCHEMA_VERSION },
      ideaId: { type: "string", pattern: AGENT_IDEA_CANDIDATE_ID_PATTERN_SOURCE },
      title: boundedCandidateString(AGENT_IDEA_CANDIDATE_LIMITS.title.maxLength),
      targetUsers: boundedCandidateStringArray(AGENT_IDEA_CANDIDATE_LIMITS.targetUsers),
      candidateTasks: boundedCandidateStringArray(AGENT_IDEA_CANDIDATE_LIMITS.candidateTasks),
      valueHypothesis: boundedCandidateString(AGENT_IDEA_CANDIDATE_LIMITS.valueHypothesis.maxLength),
      source: {
        type: "object",
        additionalProperties: false,
        required: ["discoveryDb"],
        properties: {
          discoveryDb: {
            type: "object",
            additionalProperties: false,
            required: ["identity", "subject", "digest"],
            properties: {
              identity: { const: "agentmo.discovery-db.v1" },
              subject: { const: "discovery-db" },
              digest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
            },
          },
        },
      },
      evidenceIds: {
        ...boundedCandidateStringArray(AGENT_IDEA_CANDIDATE_LIMITS.evidenceIds),
        uniqueItems: true,
        description: "Fact IDs must be strictly ascending by UTF-8 byte order as well as unique.",
        "x-agentmo-byte-sorted-unique": true,
      },
      evidenceGaps: boundedCandidateStringArray(AGENT_IDEA_CANDIDATE_LIMITS.evidenceGaps),
      judgmentBoundaries: boundedCandidateStringArray(AGENT_IDEA_CANDIDATE_LIMITS.judgmentBoundaries),
      certificationBoundary: {
        type: "object",
        additionalProperties: false,
        required: Object.keys(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY),
        properties: Object.fromEntries(
          Object.entries(AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY)
            .map(([key, value]) => [key, { const: value }]),
        ),
      },
    },
  },
  minimalTemplate: {
    schemaVersion: AGENT_IDEA_CANDIDATE_SCHEMA_VERSION,
    ideaId: "replace-with-idea-id",
    title: "Describe one bounded Agent Idea candidate.",
    targetUsers: ["replace with one target user"],
    candidateTasks: ["replace with one observable task"],
    valueHypothesis: "Describe proposed value without claiming it is proven.",
    source: {
      discoveryDb: {
        identity: "agentmo.discovery-db.v1",
        subject: "discovery-db",
        digest: `sha256:${"0".repeat(64)}`,
      },
    },
    evidenceIds: ["replace-with-evidence-id"],
    evidenceGaps: [],
    judgmentBoundaries: ["State what the cited evidence cannot establish."],
    certificationBoundary: { ...AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY },
  },
});

const DECISION_ENTRY_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "decision-entry",
  identity: DECISION_ENTRY_SCHEMA_VERSION,
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo Decision Entry",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "entryId",
      "entryKind",
      "subject",
      "reason",
      "sourceRefs",
      "decisionRefs",
      "requirementRefs",
    ],
    properties: {
      schemaVersion: { const: DECISION_ENTRY_SCHEMA_VERSION },
      entryId: DECISION_REF,
      entryKind: { enum: DECISION_ENTRY_KINDS },
      subject: { type: "string", minLength: 1, maxLength: 512 },
      reason: { type: "string", minLength: 1, maxLength: 4096 },
      sourceRefs: DECISION_REF_ARRAY,
      decisionRefs: DECISION_REF_ARRAY,
      requirementRefs: DECISION_REF_ARRAY,
    },
  },
  minimalTemplate: {
    schemaVersion: DECISION_ENTRY_SCHEMA_VERSION,
    entryId: "replace-with-entry-id",
    entryKind: "unknown",
    subject: "Describe the bounded planning question.",
    reason: "Record why the available evidence does not currently resolve it.",
    sourceRefs: [],
    decisionRefs: [],
    requirementRefs: [],
  },
});

const DISCOVERY_MANIFEST_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "discovery-manifest",
  identity: "agentmo.discovery.v1",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo Discovery Manifest",
    type: "object",
    required: [
      "schemaVersion",
      "agent_id",
      "source_inventory",
      "database_outputs",
      "retrieval_outputs",
      "user_need_inputs",
      "refresh_policy",
      "forbidden_data_handling",
    ],
    properties: {
      schemaVersion: { const: "agentmo.discovery.v1" },
      agent_id: NON_EMPTY_STRING,
      source_inventory: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["id", "type", "trust_level", "description", "extraction_fields"],
          properties: {
            id: NON_EMPTY_STRING,
            type: {
              enum: [
                "document",
                "database",
                "retrieval_corpus",
                "tool_output",
                "user_interview",
                "runtime_trace",
                "manual_inventory",
              ],
            },
            trust_level: {
              enum: ["verified", "trusted", "derived", "unverified", "unknown"],
            },
            evidence_class: {
              enum: ["primary", "first-party", "context", "community"],
            },
            description: NON_EMPTY_STRING,
            location: NON_EMPTY_STRING,
            extraction_fields: NON_EMPTY_STRING_ARRAY,
          },
        },
      },
      database_outputs: NON_EMPTY_STRING_ARRAY,
      retrieval_outputs: NON_EMPTY_STRING_ARRAY,
      user_need_inputs: NON_EMPTY_STRING_ARRAY,
      refresh_policy: {
        type: "object",
        required: ["cadence", "owner", "stale_after"],
        properties: {
          cadence: NON_EMPTY_STRING,
          owner: NON_EMPTY_STRING,
          stale_after: NON_EMPTY_STRING,
        },
      },
      forbidden_data_handling: NON_EMPTY_STRING_ARRAY,
      collector: {
        type: "object",
        required: [
          "schemaVersion",
          "adapter",
          "allowlist",
          "maxSources",
          "maxBytesPerSource",
          "perSourceTimeoutMs",
          "aggregateTimeoutMs",
          "maxRedirects",
          "allowedContentTypes",
        ],
        properties: {
          schemaVersion: { const: "agentmo.discovery-live-policy.v1" },
          adapter: { type: "string", enum: ["web", "github", "arxiv"] },
          allowlist: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", format: "uri", pattern: "^https://" },
          },
          maxSources: { type: "integer", minimum: 1, maximum: 32 },
          maxBytesPerSource: { type: "integer", minimum: 1, maximum: 1_048_576 },
          perSourceTimeoutMs: { type: "integer", minimum: 1, maximum: 60_000 },
          aggregateTimeoutMs: { type: "integer", minimum: 1, maximum: 300_000 },
          maxRedirects: { type: "integer", minimum: 0, maximum: 5 },
          allowedContentTypes: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: NON_EMPTY_STRING,
          },
        },
      },
    },
  },
  minimalTemplate: {
    schemaVersion: "agentmo.discovery.v1",
    agent_id: "replace-with-agent-id",
    source_inventory: [
      {
        id: "replace-with-source-id",
        type: "manual_inventory",
        trust_level: "unverified",
        evidence_class: "context",
        description: "Describe the bounded source and what it can establish.",
        location: "sources/replace-with-source.md",
        extraction_fields: ["replace with one bounded field"],
      },
    ],
    database_outputs: ["replace with one database output"],
    retrieval_outputs: ["replace with one retrieval output"],
    user_need_inputs: ["replace with one user need"],
    refresh_policy: {
      cadence: "replace with review cadence",
      owner: "replace with human owner",
      stale_after: "replace with bounded stale interval",
    },
    forbidden_data_handling: ["Do not persist credentials, raw transcripts, or private payloads."],
  },
});

const USER_NEED_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "user-need",
  identity: "agentmo.user-need.v1",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo User Need",
    type: "object",
    required: [
      "schemaVersion",
      "agent_id",
      "domain",
      "problem",
      "target_users",
      "primary_tasks",
      "success_criteria",
      "hard_failures",
      "output_preferences",
    ],
    properties: {
      schemaVersion: { const: "agentmo.user-need.v1" },
      agent_id: NON_EMPTY_STRING,
      domain: NON_EMPTY_STRING,
      problem: NON_EMPTY_STRING,
      target_users: NON_EMPTY_STRING_ARRAY,
      primary_tasks: NON_EMPTY_STRING_ARRAY,
      success_criteria: NON_EMPTY_STRING_ARRAY,
      hard_failures: NON_EMPTY_STRING_ARRAY,
      output_preferences: {
        type: "object",
        required: ["language", "format", "evidence_style"],
        properties: {
          language: NON_EMPTY_STRING,
          format: NON_EMPTY_STRING,
          evidence_style: NON_EMPTY_STRING,
        },
      },
      runtime_preferences: NON_EMPTY_STRING_ARRAY,
      source_refs: NON_EMPTY_STRING_ARRAY,
    },
  },
  minimalTemplate: {
    schemaVersion: "agentmo.user-need.v1",
    agent_id: "replace-with-agent-id",
    domain: "replace_with_domain",
    problem: "Describe the concrete problem, affected users, and why the workflow needs an agent.",
    target_users: ["replace with one target user"],
    primary_tasks: ["replace with one observable workflow task"],
    success_criteria: ["replace with one observable success criterion"],
    hard_failures: ["replace with one behavior that must fail closed"],
    output_preferences: {
      language: "replace with output language",
      format: "replace with output format",
      evidence_style: "replace with evidence and citation style",
    },
    runtime_preferences: ["openclaw"],
    source_refs: [],
  },
});

const OPENCLAW_TARGET_DESCRIPTOR_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "openclaw-target-descriptor",
  identity: "agentmo.openclaw-target-descriptor.v1",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo OpenClaw Exact Target Descriptor",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "target",
      "targetRoot",
      "members",
      "provenance",
      "certificationBoundary",
      "authorityDigest",
    ],
    properties: {
      schemaVersion: { const: "agentmo.openclaw-target-descriptor.v1" },
      target: { type: "object", additionalProperties: false },
      targetRoot: { type: "object", additionalProperties: false },
      members: { type: "array", minItems: 3, maxItems: 3 },
      provenance: { type: "object", additionalProperties: false },
      certificationBoundary: { type: "object", additionalProperties: false },
      authorityDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
    },
  },
  minimalTemplate: targetDescriptorMinimalTemplate(),
});

const OPENCLAW_TARGET_CARRIER_ADMISSION_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "openclaw-target-carrier-admission",
  identity: "agentmo.openclaw-target-carrier-admission.v1",
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo OpenClaw Target/Carrier Admission",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "decision",
      "target",
      "authorities",
      "carrier",
      "hookMappings",
      "certificationBoundary",
    ],
    properties: {
      schemaVersion: { const: "agentmo.openclaw-target-carrier-admission.v1" },
      decision: { const: "admit-exact-target-and-native-plugin-recipe" },
      target: { type: "object", additionalProperties: false },
      authorities: { type: "object", additionalProperties: false },
      carrier: { type: "object", additionalProperties: false },
      hookMappings: { type: "array", minItems: 4, maxItems: 4 },
      certificationBoundary: { type: "object", additionalProperties: false },
    },
  },
  minimalTemplate: {
    schemaVersion: "agentmo.openclaw-target-carrier-admission.v1",
    decision: "admit-exact-target-and-native-plugin-recipe",
    target: {
      id: "openclaw",
      version: "replace-with-descriptor-version",
      sourceRevision: "0".repeat(40),
      displayRevision: "0".repeat(7),
      nodeRange: "replace-with-descriptor-node-range",
      descriptorDigest: `sha256:${"0".repeat(64)}`,
      executableDigest: `sha256:${"0".repeat(64)}`,
      packageJsonDigest: `sha256:${"0".repeat(64)}`,
      buildInfoDigest: `sha256:${"0".repeat(64)}`,
      targetRootDigest: `sha256:${"0".repeat(64)}`,
    },
    authorities: {
      blueprintDigest: `sha256:${"0".repeat(64)}`,
      buildContractDigest: `sha256:${"0".repeat(64)}`,
      planApprovalDigest: `sha256:${"0".repeat(64)}`,
      nativePluginRecipeDigest: `sha256:${"0".repeat(64)}`,
      targetDescriptorDigest: `sha256:${"0".repeat(64)}`,
    },
    carrier: {
      kind: "native-plugin",
      owner: "agentmo-openclaw-harness",
      implementationPathAccepted: false,
      mcp: false,
    },
    hookMappings: [
      ["after-attempt", "agent_end", "observe-attempt-completion"],
      ["after-tool", "after_tool_call", "observe-tool-result-metadata"],
      ["before-attempt", "before_agent_run", "enforce-attempt-boundary"],
      ["before-checkpoint", "before_compaction", "enforce-checkpoint-boundary"],
    ].map(([abstractHook, openclawEvent, permission]) => ({
      abstractHook,
      openclawEvent,
      permission,
      timeoutMs: 5000,
      failureSemantics: "fail-closed",
    })),
    certificationBoundary: {
      targetAndCarrierAdmissionOnly: true,
      pluginBytesMaterialized: false,
      packageBuilt: false,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  },
});

const PACKAGE_MANIFEST_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "package-manifest",
  identity: AGENT_PACKAGE_SCHEMA_VERSION,
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo Agent Package Manifest",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "packageId",
      "packageVersion",
      "sourceBindings",
      "targetCompatibility",
      "capabilityIds",
      "capabilityLedger",
      "members",
      "inventoryDigest",
      "ownership",
      "permissions",
      "evidenceRefs",
      "certificationBoundary",
      "remainingRisks",
    ],
    properties: {
      schemaVersion: { const: AGENT_PACKAGE_SCHEMA_VERSION },
      packageId: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" },
      packageVersion: {
        type: "string",
        pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[a-z0-9.-]+)?$",
      },
      sourceBindings: {
        type: "object",
        additionalProperties: false,
        required: [
          "blueprintDigest",
          "buildContractDigest",
          "designPlanDigest",
          "discoveryApprovalDigest",
          "decisionLedgerDigest",
          "planApprovalDigest",
        ],
        properties: Object.fromEntries([
          "blueprintDigest",
          "buildContractDigest",
          "designPlanDigest",
          "discoveryApprovalDigest",
          "decisionLedgerDigest",
          "planApprovalDigest",
        ].map((key) => [key, { type: "string", pattern: "^sha256:[a-f0-9]{64}$" }])),
      },
      targetCompatibility: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["target", "version", "sourceRevision", "exactRevisionRequired"],
          properties: {
            target: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" },
            version: { type: "string", minLength: 1, maxLength: 512 },
            sourceRevision: { type: "string", pattern: "^[a-f0-9]{8,64}$" },
            exactRevisionRequired: { const: true },
          },
        },
      },
      capabilityIds: {
        type: "array",
        minItems: 1,
        uniqueItems: true,
        items: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" },
      },
      capabilityLedger: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: [
            "capabilityId",
            "resourceId",
            "carrier",
            "owner",
            "necessity",
            "trust",
            "memberPaths",
            "recipeDigest",
            "targetMapping",
            "permission",
            "approvalRequirement",
            "timeoutMs",
            "failureSemantics",
            "unsupportedBehavior",
          ],
          properties: {
            capabilityId: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" },
            resourceId: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" },
            carrier: { enum: ["workspace-content", "skill", "native-plugin", "mcp"] },
            owner: { type: "string", pattern: "^[a-z0-9][a-z0-9._:-]{0,127}$" },
            necessity: { type: "string", minLength: 1, maxLength: 512 },
            trust: { type: "string", minLength: 1, maxLength: 512 },
            memberPaths: {
              type: "array",
              minItems: 1,
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 512 },
            },
            recipeDigest: {
              anyOf: [
                { type: "null" },
                { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
              ],
            },
            targetMapping: {
              type: "object",
              additionalProperties: false,
              required: ["target", "event", "versionRange"],
              properties: {
                target: { const: "openclaw" },
                event: { anyOf: [{ type: "null" }, { type: "string", minLength: 1 }] },
                versionRange: {
                  type: "string",
                  pattern: "^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?@[a-f0-9]{7,40}$",
                },
              },
            },
            permission: { type: "string", minLength: 1, maxLength: 512 },
            approvalRequirement: { type: "string", minLength: 1, maxLength: 512 },
            timeoutMs: {
              anyOf: [
                { type: "null" },
                { type: "integer", minimum: 1 },
              ],
            },
            failureSemantics: { const: "fail-closed" },
            unsupportedBehavior: {
              type: "array",
              uniqueItems: true,
              items: { type: "string", minLength: 1, maxLength: 512 },
            },
          },
        },
      },
      members: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["relativePath", "type", "mode", "byteLength", "sha256"],
          properties: {
            relativePath: { type: "string", minLength: 1, maxLength: 512 },
            type: { const: "file" },
            mode: { enum: [0o644, 0o755] },
            byteLength: { type: "integer", minimum: 0 },
            sha256: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
          },
        },
      },
      inventoryDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      ownership: {
        type: "object",
        additionalProperties: false,
        required: ["packageOwner", "managedMemberPaths", "externalStateIncluded"],
        properties: {
          packageOwner: { const: "agentmo" },
          managedMemberPaths: {
            type: "array",
            minItems: 1,
            uniqueItems: true,
            items: { type: "string", minLength: 1, maxLength: 512 },
          },
          externalStateIncluded: { const: false },
        },
      },
      permissions: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING },
      evidenceRefs: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING },
      certificationBoundary: {
        type: "object",
        additionalProperties: false,
        required: [
          "deterministicPackageMechanism",
          "installed",
          "runtime",
          "domain",
          "production",
        ],
        properties: {
          deterministicPackageMechanism: { const: true },
          installed: { const: false },
          runtime: { const: false },
          domain: { const: false },
          production: { const: false },
        },
      },
      remainingRisks: { type: "array", minItems: 1, uniqueItems: true, items: NON_EMPTY_STRING },
    },
  },
  minimalTemplate: packageManifestMinimalTemplate(),
});

const OPENCLAW_PROBE_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "openclaw-probe",
  identity: OPENCLAW_PROBE_SCHEMA_VERSION,
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo OpenClaw Capability Probe",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion", "status", "fingerprintDigest", "producer",
      "sourceBindings", "archive", "target", "runtime", "cli", "surfaces",
      "required", "isolation", "compatibility", "certificationBoundary",
      "remainingRisks",
    ],
    properties: {
      schemaVersion: { const: OPENCLAW_PROBE_SCHEMA_VERSION },
      status: { enum: ["compatible", "incompatible"] },
      fingerprintDigest: { type: "string", pattern: "^sha256:[a-f0-9]{64}$" },
      producer: { type: "object" },
      sourceBindings: { type: "object" },
      archive: { type: "object" },
      target: { type: "object" },
      runtime: { type: "object" },
      cli: { type: "object" },
      surfaces: { type: "object" },
      required: { type: "object" },
      isolation: { type: "object" },
      compatibility: { type: "object" },
      certificationBoundary: { type: "object" },
      remainingRisks: { type: "array", minItems: 1, items: NON_EMPTY_STRING },
    },
  },
  minimalTemplate: openClawProbeMinimalTemplate(),
});

const OPENCLAW_INSTALL_RECEIPT_CONTRACT = deepFreeze({
  schemaVersion: "agentmo.artifact-contract.v1",
  subject: "openclaw-install-receipt",
  identity: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
  jsonSchema: {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    title: "AgentMo OpenClaw Install Receipt",
    type: "object",
    additionalProperties: false,
    required: [
      "schemaVersion",
      "status",
      "lifecycle",
      "authorityLedger",
      "approvals",
      "nonceConsumption",
      "predecessor",
      "lineage",
      "managedResults",
      "externalResults",
      "postEffectEvidence",
      "preservedAssets",
      "recovery",
      "incompleteReasons",
      "certificationBoundary",
    ],
    properties: {
      schemaVersion: { const: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION },
      status: { enum: ["complete", "incomplete"] },
      lifecycle: { enum: ["install", "upgrade", "rollback", "uninstall"] },
      authorityLedger: { type: "object", additionalProperties: false },
      approvals: { type: "object", additionalProperties: false },
      nonceConsumption: { type: "object", additionalProperties: false },
      predecessor: { type: "object", additionalProperties: false },
      lineage: { type: "object", additionalProperties: false },
      managedResults: { type: "array", minItems: 1 },
      externalResults: { type: "array" },
      postEffectEvidence: { type: "object", additionalProperties: false },
      preservedAssets: { type: "array" },
      recovery: { type: "object", additionalProperties: false },
      incompleteReasons: {
        type: "array",
        uniqueItems: true,
        items: NON_EMPTY_STRING,
      },
      certificationBoundary: { type: "object", additionalProperties: false },
    },
  },
  minimalTemplate: openClawInstallReceiptMinimalTemplate(),
});

const OPENCLAW_INSTALL_PRIVATE_JOURNAL_CONTRACT = lifecycleContract(
  "openclaw-install-private-journal",
  OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
  "AgentMo OpenClaw Install Private Journal",
  openClawInstallPrivateJournalMinimalTemplate(),
);

const POST_EFFECT_TEMPLATES = openClawPostEffectMinimalTemplates();
const OPENCLAW_INSTALL_POST_STATE_CONTRACT = lifecycleContract(
  "openclaw-install-post-state",
  OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
  "AgentMo OpenClaw Install Post-State Evidence",
  POST_EFFECT_TEMPLATES.postState,
);
const OPENCLAW_OFFICIAL_ACTION_RESULT_CONTRACT = lifecycleContract(
  "openclaw-official-action-result",
  OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
  "AgentMo OpenClaw Official Action Result Evidence",
  POST_EFFECT_TEMPLATES.officialActionResult,
);
const OPENCLAW_INSTALL_FINALIZATION_CONTRACT = lifecycleContract(
  "openclaw-install-finalization",
  OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
  "AgentMo OpenClaw Install Finalization Evidence",
  POST_EFFECT_TEMPLATES.finalization,
);

const LIFECYCLE_TEMPLATES = openClawLifecycleMinimalTemplates();
const OPENCLAW_ABSENT_GENESIS_CONTRACT = lifecycleContract(
  "openclaw-absent-genesis",
  OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
  "AgentMo OpenClaw Verified Absent Genesis",
  LIFECYCLE_TEMPLATES.genesis,
);
const OPENCLAW_INSTALL_PLAN_CONTRACT = lifecycleContract(
  "openclaw-install-plan",
  OPENCLAW_INSTALL_PLAN_SCHEMA_VERSION,
  "AgentMo OpenClaw Install Plan",
  LIFECYCLE_TEMPLATES.plan,
);
const OPENCLAW_INSTALL_APPROVAL_CONTRACT = lifecycleContract(
  "openclaw-install-approval",
  OPENCLAW_INSTALL_APPROVAL_SCHEMA_VERSION,
  "AgentMo OpenClaw Ordinary Install Approval",
  LIFECYCLE_TEMPLATES.ordinary,
);
const OPENCLAW_SENSITIVE_ACTION_DECISION_CONTRACT = lifecycleContract(
  "openclaw-sensitive-action-decision",
  OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
  "AgentMo OpenClaw Sensitive Action Decision",
  LIFECYCLE_TEMPLATES.sensitive,
);
const OPENCLAW_CONFLICT_APPROVAL_CONTRACT = lifecycleContract(
  "openclaw-conflict-approval",
  OPENCLAW_CONFLICT_APPROVAL_SCHEMA_VERSION,
  "AgentMo OpenClaw Exact Conflict Approval",
  LIFECYCLE_TEMPLATES.conflict,
);

const CONTRACTS = new Map([
  [AGENT_IDEA_CANDIDATE_CONTRACT.subject, AGENT_IDEA_CANDIDATE_CONTRACT],
  [DECISION_ENTRY_CONTRACT.subject, DECISION_ENTRY_CONTRACT],
  [DISCOVERY_MANIFEST_CONTRACT.subject, DISCOVERY_MANIFEST_CONTRACT],
  [USER_NEED_CONTRACT.subject, USER_NEED_CONTRACT],
  [OPENCLAW_TARGET_DESCRIPTOR_CONTRACT.subject, OPENCLAW_TARGET_DESCRIPTOR_CONTRACT],
  [
    OPENCLAW_TARGET_CARRIER_ADMISSION_CONTRACT.subject,
    OPENCLAW_TARGET_CARRIER_ADMISSION_CONTRACT,
  ],
  [PACKAGE_MANIFEST_CONTRACT.subject, PACKAGE_MANIFEST_CONTRACT],
  [OPENCLAW_PROBE_CONTRACT.subject, OPENCLAW_PROBE_CONTRACT],
  [
    OPENCLAW_INSTALL_PRIVATE_JOURNAL_CONTRACT.subject,
    OPENCLAW_INSTALL_PRIVATE_JOURNAL_CONTRACT,
  ],
  [
    OPENCLAW_INSTALL_POST_STATE_CONTRACT.subject,
    OPENCLAW_INSTALL_POST_STATE_CONTRACT,
  ],
  [
    OPENCLAW_OFFICIAL_ACTION_RESULT_CONTRACT.subject,
    OPENCLAW_OFFICIAL_ACTION_RESULT_CONTRACT,
  ],
  [
    OPENCLAW_INSTALL_FINALIZATION_CONTRACT.subject,
    OPENCLAW_INSTALL_FINALIZATION_CONTRACT,
  ],
  [OPENCLAW_INSTALL_RECEIPT_CONTRACT.subject, OPENCLAW_INSTALL_RECEIPT_CONTRACT],
  [OPENCLAW_ABSENT_GENESIS_CONTRACT.subject, OPENCLAW_ABSENT_GENESIS_CONTRACT],
  [OPENCLAW_INSTALL_PLAN_CONTRACT.subject, OPENCLAW_INSTALL_PLAN_CONTRACT],
  [OPENCLAW_INSTALL_APPROVAL_CONTRACT.subject, OPENCLAW_INSTALL_APPROVAL_CONTRACT],
  [
    OPENCLAW_SENSITIVE_ACTION_DECISION_CONTRACT.subject,
    OPENCLAW_SENSITIVE_ACTION_DECISION_CONTRACT,
  ],
  [OPENCLAW_CONFLICT_APPROVAL_CONTRACT.subject, OPENCLAW_CONFLICT_APPROVAL_CONTRACT],
]);

export function getArtifactContract(subject) {
  return CONTRACTS.get(subject) ?? null;
}

export function listArtifactContractSubjects() {
  return Object.freeze(
    [...CONTRACTS.keys()]
      .filter((subject) => ![
        "openclaw-install-receipt",
        "openclaw-install-private-journal",
        "openclaw-install-post-state",
        "openclaw-official-action-result",
        "openclaw-install-finalization",
        "openclaw-absent-genesis",
        "openclaw-install-plan",
        "openclaw-install-approval",
        "openclaw-sensitive-action-decision",
        "openclaw-conflict-approval",
      ].includes(subject))
      .sort(),
  );
}

export function formatArtifactContract(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}

function boundedStringArray(minItems, maxItems, maxLength) {
  return {
    type: "array",
    minItems,
    maxItems,
    items: {
      type: "string",
      minLength: 1,
      maxLength,
    },
  };
}

function boundedCandidateString(maxLength) {
  return {
    type: "string",
    minLength: 1,
    maxLength,
    pattern: AGENT_IDEA_CANDIDATE_TEXT_PATTERN_SOURCE,
  };
}

function boundedCandidateStringArray(limits) {
  return {
    type: "array",
    minItems: limits.minItems,
    maxItems: limits.maxItems,
    items: boundedCandidateString(limits.itemMaxLength),
  };
}

function targetDescriptorMinimalTemplate() {
  const identityBasis = {
    device: "0",
    inode: "0",
    size: "1",
    mtimeNs: "0",
    ctimeNs: "0",
  };
  const members = [
    ["build-info", "dist/build-info.json"],
    ["executable", "openclaw.mjs"],
    ["package-json", "package.json"],
  ].map(([role, relativePath]) => ({
    role,
    relativePath,
    byteLength: 1,
    sha256: `sha256:${"0".repeat(64)}`,
    identityBasis: { ...identityBasis },
  }));
  const basis = {
    schemaVersion: "agentmo.openclaw-target-descriptor.v1",
    target: {
      id: "openclaw",
      version: "replace-with-observed-version",
      sourceRevision: "0".repeat(40),
      displayRevision: "0".repeat(7),
      nodeRange: "replace-with-package-engines-node",
    },
    targetRoot: {
      identityScheme: "retained-stat-and-canonical-member-closure-v1",
      memberClosureDigest: digestTemplate(members),
      identityBasis: { ...identityBasis, size: "0" },
    },
    members,
    provenance: {
      authority: "installed-first-party-package-observation",
      packageName: "openclaw",
      observation: "retained-no-follow-read-only",
      versionAuthority: "package-json-and-build-info-exact-match",
      revisionAuthority: "build-info-commit",
      nodeRangeAuthority: "package-json-engines-node",
    },
    certificationBoundary: {
      targetIdentityObservationOnly: true,
      sourceQuality: false,
      packageBuilt: false,
      installedByAgentMo: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  return {
    ...basis,
    authorityDigest: digestTemplate(basis),
  };
}

function packageManifestMinimalTemplate() {
  const zeroDigest = `sha256:${"0".repeat(64)}`;
  const member = {
    relativePath: "resources/workspace/context.json",
    type: "file",
    mode: 0o644,
    byteLength: 1,
    sha256: zeroDigest,
  };
  const members = [member];
  return {
    schemaVersion: AGENT_PACKAGE_SCHEMA_VERSION,
    packageId: "replace-with-package-id",
    packageVersion: "1.0.0",
    sourceBindings: {
      blueprintDigest: zeroDigest,
      buildContractDigest: zeroDigest,
      designPlanDigest: zeroDigest,
      discoveryApprovalDigest: zeroDigest,
      decisionLedgerDigest: zeroDigest,
      planApprovalDigest: zeroDigest,
    },
    targetCompatibility: [{
      target: "openclaw",
      version: "2026.7.1-2",
      sourceRevision: "0".repeat(40),
      exactRevisionRequired: true,
    }],
    capabilityIds: ["resource:workspace-context"],
    capabilityLedger: [{
      capabilityId: "resource:workspace-context",
      resourceId: "resource:workspace-context",
      carrier: "workspace-content",
      owner: "agent-package",
      necessity: "portable-declarative-resource",
      trust: "workspace-content",
      memberPaths: [member.relativePath],
      recipeDigest: null,
      targetMapping: {
        target: "openclaw",
        event: null,
        versionRange: `2026.7.1-2@${"0".repeat(7)}`,
      },
      permission: "permission:workspace-context",
      approvalRequirement: "contract-scoped",
      timeoutMs: null,
      failureSemantics: "fail-closed",
      unsupportedBehavior: [],
    }],
    members,
    inventoryDigest: digestTemplate(members),
    ownership: {
      packageOwner: "agentmo",
      managedMemberPaths: [member.relativePath],
      externalStateIncluded: false,
    },
    permissions: ["permission:workspace-context"],
    evidenceRefs: ["evidence:workspace-context"],
    certificationBoundary: {
      deterministicPackageMechanism: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
    remainingRisks: ["Installation and runtime evidence require separate governed transitions."],
  };
}

function digestTemplate(value) {
  return `sha256:${createHash("sha256")
    .update(Buffer.from(`${JSON.stringify(value, null, 2)}\n`, "utf8"))
    .digest("hex")}`;
}

function openClawProbeMinimalTemplate() {
  const digest = `sha256:${"0".repeat(64)}`;
  const provenance = (identity, subject) => ({
    identity,
    subject,
    digest,
  });
  const sourceBindings = {
    archive: provenance("agentmo.package-archive.v1", "package-archive"),
    packageManifest: provenance("agentmo.package-manifest.v1", "package-manifest"),
    blueprint: provenance("agentmo.blueprint.v1", "blueprint"),
    buildContract: provenance("agentmo.build-contract.v1", "build-contract"),
    planApproval: provenance("agentmo.plan-approval.v1", "plan-approval"),
    targetCarrierAdmission: provenance(
      "agentmo.openclaw-target-carrier-admission.v1",
      "openclaw-target-carrier-admission",
    ),
    targetDescriptor: provenance(
      "agentmo.openclaw-target-descriptor.v1",
      "openclaw-target-descriptor",
    ),
  };
  const archive = {
    archiveDigest: digest,
    manifestDigest: digest,
    inventoryDigest: digest,
    memberClosureDigest: digest,
    memberCount: 1,
  };
  const target = {
    id: "openclaw",
    version: "2026.7.1-2",
    sourceRevision: "0790d9f",
    displayRevision: "0790d9f",
    nodeRange: ">=24.15.0 <25",
    descriptorDigest: digest,
    targetCarrierAdmissionDigest: digest,
    targetRootDigest: digest,
    memberClosureDigest: digest,
    memberDigests: [
      {
        role: "executable",
        relativePath: "openclaw.mjs",
        sha256: digest,
        byteLength: 1,
      },
      {
        role: "package-json",
        relativePath: "package.json",
        sha256: digest,
        byteLength: 1,
      },
      {
        role: "build-info",
        relativePath: "build-info.json",
        sha256: digest,
        byteLength: 1,
      },
    ],
    exactTargetMatch: true,
  };
  const runtime = { supported: true };
  const outputFacts = {
    kind: "empty",
    digest,
    byteLength: 0,
    fields: [],
  };
  const observation = (id, argv) => ({
    id,
    argv,
    exitCode: 0,
    signal: null,
    timedOut: false,
    standardOutputFacts: outputFacts,
    standardErrorFacts: outputFacts,
  });
  const cli = {
    executableDigest: digest,
    observations: [
      observation("version", ["--version"]),
      observation("skill-eligibility", ["skills", "list", "--eligible", "--json"]),
      observation("config-validation", ["config", "validate", "--json"]),
    ],
    contractDigest: digest,
  };
  const surfaces = {
    workspace: digest,
    skills: digest,
    plugins: "manifest-only-no-runtime-load",
    mcp: "unsupported-no-package-no-connection",
    sandboxToolPolicy: digest,
    permissionRoute: digest,
    config: digest,
    conflicts: digest,
  };
  const required = {
    observationIds: ["version", "skill-eligibility", "config-validation"],
    satisfiedObservationIds: ["version", "skill-eligibility", "config-validation"],
    allSatisfied: true,
  };
  const producer = {
    id: "agentmo.openclaw-probe",
    contractVersion: OPENCLAW_PROBE_SCHEMA_VERSION,
    freshObservation: true,
  };
  const isolation = {
    disposableSyntheticHome: true,
    explicitStateConfigWorkspace: true,
    privateExecutableCopy: true,
    privateWorkingDirectory: true,
    retainedSourceHandles: true,
    sourceRevalidatedBetweenObservations: true,
    inheritedEnvironment: false,
    shell: false,
    syntheticHomeDiscarded: false,
    operatorHomeObserved: false,
    operatorStateMutated: false,
  };
  const compatibility = {
    exactArchiveMatch: true,
    exactTargetMatch: true,
    currentProcessSupported: true,
    requiredObservationsSatisfied: true,
    status: "compatible",
    supportCertified: false,
  };
  const certificationBoundary = {
    readOnlyCapabilityObservation: true,
    installed: false,
    pluginLoaded: false,
    mcpConnected: false,
    agentInvoked: false,
    scheduleTriggered: false,
    credentialsUsed: false,
    runtime: false,
    domain: false,
    birth: false,
    delivery: false,
    production: false,
  };
  const template = {
    schemaVersion: OPENCLAW_PROBE_SCHEMA_VERSION,
    status: "compatible",
    fingerprintDigest: digest,
    producer,
    sourceBindings,
    archive,
    target,
    runtime,
    cli,
    surfaces,
    required,
    isolation,
    compatibility,
    certificationBoundary,
    remainingRisks: ["This contract proves bounded target observation only."],
  };
  template.fingerprintDigest = digestTemplate({
    schemaVersion: "agentmo.openclaw-probe-fingerprint-basis.v1",
    status: template.status,
    producer,
    sourceBindings,
    archive,
    target,
    runtime,
    cli,
    surfaces,
    required,
    isolation,
    compatibility,
    certificationBoundary,
  });
  return template;
}

function openClawInstallReceiptMinimalTemplate() {
  const digest = (label) => digestTemplate({ label });
  const provenance = (identity, subject, label) => ({
    identity,
    subject,
    digest: digest(label),
  });
  const members = [{
    relativePath: "agentmo.package.json",
    type: "file",
    mode: 0o644,
    byteLength: 1,
    sha256: digest("manifest-member"),
  }];
  const archive = {
    archiveSha256: digest("archive"),
    manifestDigest: members[0].sha256,
    inventoryDigest: digestTemplate(members),
    members,
  };
  const approval = (family, label) => ({
    family,
    artifact: provenance(
      family === "ordinary"
        ? "agentmo.openclaw-install-approval.v1"
        : "agentmo.openclaw-conflict-approval.v1",
      family === "ordinary"
        ? "openclaw-install-approval"
        : "openclaw-conflict-approval",
      `${label}-artifact`,
    ),
    decisionDigest: digest(`${label}-decision`),
    nonceDigest: digest(`${label}-nonce`),
    actionId: null,
    actionDigest: null,
    conflictSetDigest: family === "conflict"
      ? digest(`${label}-conflicts`)
      : null,
  });
  const approvals = {
    ordinary: approval("ordinary", "ordinary"),
    sensitive: [],
    conflict: approval("conflict", "conflict"),
  };
  const marker = (binding, label, inode) => ({
    family: binding.family,
    path: `.agentmo/openclaw-authority/${label}.json`,
    digest: digest(`${label}-marker`),
    nonceDigest: binding.nonceDigest,
    decisionDigest: binding.decisionDigest,
    actionDigest: binding.actionDigest,
    conflictSetDigest: binding.conflictSetDigest,
    device: "1",
    inode,
    status: "created",
    consumed: true,
  });
  const markers = [
    marker(approvals.ordinary, "ordinary", "1"),
    marker(approvals.conflict, "conflict", "2"),
  ];
  const markerBasis = markers.map(({ consumed, status, ...item }) => item);
  const attemptId = "replace-with-attempt";
  const attemptDigest = `sha256:${createHash("sha256")
    .update(Buffer.from(attemptId, "utf8"))
    .digest("hex")}`;
  const canonicalEvidence = (identity, subject, label, inode) => ({
    identity,
    subject,
    digest: digest(`${label}-evidence`),
    authorityId: digest("authority-ledger"),
    rootIdentity: { device: "1", inode: "30" },
    relativeRef: `${label}/${attemptDigest.slice("sha256:".length)}.json`,
    fileIdentity: { device: "1", inode },
    attemptDigest,
  });
  return {
    schemaVersion: OPENCLAW_INSTALL_RECEIPT_SCHEMA_VERSION,
    status: "complete",
    lifecycle: "install",
    authorityLedger: {
      installPlan: {
        artifact: provenance(
          "agentmo.openclaw-install-plan.v1",
          "openclaw-install-plan",
          "plan-artifact",
        ),
        installPlanDigest: digest("install-plan"),
      },
      archive,
      target: {
        targetId: "openclaw",
        targetVersion: "replace-with-observed-version",
        targetRevision: "0".repeat(40),
        probeFingerprintDigest: digest("probe-fingerprint"),
        scope: "project",
        projectId: "replace-with-project-id",
      },
      targetDescriptor: provenance(
        "agentmo.openclaw-target-descriptor.v1",
        "openclaw-target-descriptor",
        "target-descriptor",
      ),
      probe: {
        artifact: provenance(
          "agentmo.openclaw-probe.v1",
          "openclaw-probe",
          "probe-artifact",
        ),
        fingerprintDigest: digest("probe-fingerprint"),
        executableDigest: digest("openclaw-executable"),
      },
      journal: provenance(
        OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
        "openclaw-install-private-journal",
        "journal",
      ),
      attempt: {
        attemptId,
        attemptDigest,
      },
    },
    approvals,
    nonceConsumption: {
      markerSetDigest: digestTemplate(markerBasis),
      markers,
    },
    predecessor: {
      kind: "absent-genesis",
      absentGenesisDigest: digest("absent-genesis"),
    },
    lineage: {
      sequence: 0,
      predecessorReceiptDigest: null,
      selectedPredecessorReceiptDigest: null,
    },
    managedResults: [{
      path: ".openclaw/projects/replace-with-project/AGENTS.md",
      operation: "write",
      operationDigest: digest("managed-operation"),
      ownerMarker: "agentmo:package:replace-with-project",
      beforeDigest: null,
      beforeFileIdentity: null,
      beforeParentIdentity: { device: "1", inode: "1" },
      afterDigest: digest("managed-after"),
      afterFileIdentity: { device: "1", inode: "2" },
      afterParentIdentity: { device: "1", inode: "1" },
      disposition: "succeeded",
      postStateMatches: true,
      rollbackDisposition: "not-required",
      reasonCode: null,
    }],
    externalResults: [],
    postEffectEvidence: {
      finalization: canonicalEvidence(
        OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
        "openclaw-install-finalization",
        "finalizations",
        "32",
      ),
      postState: canonicalEvidence(
        OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
        "openclaw-install-post-state",
        "post-state",
        "31",
      ),
      officialActionResults: [],
    },
    preservedAssets: [],
    recovery: {
      required: false,
      disposition: "not-required",
      removedAssets: [],
      preservedAssets: [],
      reasons: [],
    },
    incompleteReasons: [],
    certificationBoundary: {
      lifecycleEvidenceOnly: true,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
      widerOpenClawCompatibility: false,
    },
  };
}

function openClawInstallPrivateJournalMinimalTemplate() {
  const digest = (label) => digestTemplate({ label });
  const members = [{
    relativePath: "agentmo.package.json",
    type: "file",
    mode: 0o644,
    byteLength: 1,
    sha256: digest("journal-manifest-member"),
  }];
  const markers = [
    {
      family: "ordinary",
      path: ".agentmo/openclaw-authority/ordinary.json",
      digest: digest("journal-ordinary-marker"),
      nonceDigest: digest("journal-ordinary-nonce"),
      decisionDigest: digest("journal-ordinary-decision"),
      actionDigest: null,
      conflictSetDigest: null,
      device: "1",
      inode: "1",
      status: "created",
    },
    {
      family: "conflict",
      path: ".agentmo/openclaw-authority/conflict.json",
      digest: digest("journal-conflict-marker"),
      nonceDigest: digest("journal-conflict-nonce"),
      decisionDigest: digest("journal-conflict-decision"),
      actionDigest: null,
      conflictSetDigest: digest("journal-conflicts"),
      device: "1",
      inode: "2",
      status: "created",
    },
  ];
  const markerBasis = markers.map(({ status, ...item }) => item);
  return {
    schemaVersion: OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
    attemptId: "replace-with-attempt",
    lifecycle: "install",
    installPlanDigest: digest("journal-install-plan"),
    archiveBinding: {
      archiveSha256: digest("journal-archive"),
      manifestDigest: members[0].sha256,
      inventoryDigest: digestTemplate(members),
      members,
    },
    authorityReservation: {
      markerSetDigest: digestTemplate(markerBasis),
      markers,
    },
    predecessor: {
      kind: "absent-genesis",
      absentGenesisDigest: digest("journal-absent-genesis"),
    },
    observations: [],
    valuesPersisted: false,
    rawOutputPersisted: false,
  };
}

function openClawPostEffectMinimalTemplates() {
  const digest = (label) => digestTemplate({ label });
  const attemptId = "replace-with-attempt";
  const attemptDigest = `sha256:${createHash("sha256")
    .update(Buffer.from(attemptId, "utf8"))
    .digest("hex")}`;
  const rootIdentity = { device: "1", inode: "30" };
  const ledger = {
    authorityId: digest("authority-ledger"),
    rootIdentity,
  };
  const attempt = { attemptId, attemptDigest };
  const plan = {
    artifact: {
      identity: "agentmo.openclaw-install-plan.v1",
      subject: "openclaw-install-plan",
      digest: digest("install-plan-artifact"),
    },
    installPlanDigest: digest("install-plan"),
  };
  const journal = {
    artifact: {
      identity: OPENCLAW_INSTALL_PRIVATE_JOURNAL_SCHEMA_VERSION,
      subject: "openclaw-install-private-journal",
      digest: digest("install-private-journal"),
    },
    relativeRef: `.agentmo-openclaw-install-${
      plan.installPlanDigest.slice("sha256:".length)
    }-${attemptDigest.slice("sha256:".length)}.journal.json`,
  };
  const canonicalProvenance = (
    identity,
    subject,
    label,
    inode,
    extra = {},
  ) => ({
    identity,
    subject,
    digest: digest(`${label}-evidence`),
    authorityId: ledger.authorityId,
    rootIdentity,
    relativeRef: `${label}/${attemptDigest.slice("sha256:".length)}.json`,
    fileIdentity: { device: "1", inode },
    attemptDigest,
    ...extra,
  });
  const observations = [{
    path: "openclaw/workspace/AGENTS.md",
    operationDigest: digest("managed-operation"),
    disposition: "observed",
    digest: digest("managed-result"),
    fileIdentity: {
      device: "1",
      inode: "41",
      mode: "600",
      owner: "1",
      size: "1",
    },
    parentIdentity: { device: "1", inode: "40" },
    reasonCode: null,
  }];
  const postState = {
    schemaVersion: OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
    ledger,
    attempt,
    plan,
    journal,
    target: {
      descriptor: {
        identity: "agentmo.openclaw-target-descriptor.v1",
        subject: "openclaw-target-descriptor",
        digest: digest("target-descriptor"),
      },
      identity: {
        targetId: "openclaw",
        scope: "project",
        projectId: "replace-with-project-id",
      },
      managedRootIdentity: { device: "1", inode: "40" },
    },
    observations,
    observationSetDigest: digestTemplate(observations),
    rawOutputPersisted: false,
  };
  const actionId = "setup:openclaw-profile:replace-with-provider";
  const actionDigest = digest("official-action");
  const actionResultProvenance = canonicalProvenance(
    OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
    "openclaw-official-action-result-evidence",
    "official-action-results",
    "42",
    { actionId, actionDigest },
  );
  const officialActionResult = {
    schemaVersion: OPENCLAW_OFFICIAL_ACTION_RESULT_SCHEMA_VERSION,
    ledger,
    attempt,
    plan,
    action: {
      actionId,
      actionDigest,
      kind: "credential",
      route: "official-openclaw-auth",
      scope: "project",
      targetDigest: digest("official-action-target"),
    },
    decision: {
      artifact: {
        identity: OPENCLAW_SENSITIVE_ACTION_DECISION_SCHEMA_VERSION,
        subject: "openclaw-sensitive-action-decision",
        digest: digest("sensitive-decision-artifact"),
      },
      decisionDigest: digest("sensitive-decision"),
      nonceDigest: digest("sensitive-nonce"),
    },
    marker: {
      authorityId: ledger.authorityId,
      rootIdentity,
      relativeRef: "sensitive/replace-with-sensitive-marker.json",
      digest: digest("sensitive-marker"),
      fileIdentity: { device: "1", inode: "43" },
      family: "sensitive",
      nonceDigest: digest("sensitive-nonce"),
      decisionDigest: digest("sensitive-decision"),
      actionDigest,
      conflictSetDigest: null,
    },
    executable: {
      name: "openclaw",
      digest: digest("openclaw-executable"),
    },
    invocation: {
      argvDigest: digest("official-action-argv"),
      declaredDigest: digest("official-action-invocation"),
      producerDigest: null,
      cwd: ".",
      timeoutMs: 10_000,
      environmentNames: [],
    },
    processGroup: {
      dryRun: null,
      actual: {
        processStarted: false,
        processGroupClosed: false,
        quiescenceVerified: false,
      },
    },
    quiescence: {
      disposition: "not-started",
      processGroupClosed: false,
      verified: false,
    },
    resultObservation: {
      disposition: "failed",
      resultDigest: null,
      failureCode: "template-not-executed",
      unsupportedReason: null,
      publicationDisposition: "not-attempted",
    },
    rawOutputPersisted: false,
  };
  const marker = (family, label, inode, conflictSetDigest) => ({
    authorityId: ledger.authorityId,
    rootIdentity,
    relativeRef: `${family}/${label}.json`,
    digest: digest(`${label}-marker`),
    fileIdentity: { device: "1", inode },
    family,
    nonceDigest: digest(`${label}-nonce`),
    decisionDigest: digest(`${label}-decision`),
    actionDigest: null,
    conflictSetDigest,
  });
  const finalization = {
    schemaVersion: OPENCLAW_INSTALL_FINALIZATION_SCHEMA_VERSION,
    ledger,
    chainDigest: digest("finalization-chain"),
    predecessor: null,
    attempt,
    plan,
    journal,
    markers: [
      marker("ordinary", "ordinary", "44", null),
      marker("conflict", "conflict", "45", digest("conflict-set")),
    ],
    postState: canonicalProvenance(
      OPENCLAW_INSTALL_POST_STATE_SCHEMA_VERSION,
      "openclaw-install-post-state",
      "post-state",
      "41",
    ),
    officialActionResults: [],
    rawOutputPersisted: false,
  };
  return { postState, officialActionResult, actionResultProvenance, finalization };
}

function lifecycleContract(subject, identity, title, minimalTemplate) {
  return deepFreeze({
    schemaVersion: "agentmo.artifact-contract.v1",
    subject,
    identity,
    jsonSchema: {
      $schema: "https://json-schema.org/draft/2020-12/schema",
      title,
      type: "object",
      additionalProperties: false,
      required: Object.keys(minimalTemplate),
      properties: {
        schemaVersion: { const: identity },
      },
    },
    minimalTemplate,
    certificationBoundary: {
      installed: false,
      runtime: false,
      domain: false,
      birth: false,
      delivery: false,
      production: false,
    },
  });
}

function openClawLifecycleMinimalTemplates() {
  const zeroDigest = `sha256:${"0".repeat(64)}`;
  const members = [{
    relativePath: "agentmo.package.json",
    type: "file",
    mode: 0o644,
    byteLength: 1,
    sha256: zeroDigest,
  }];
  const archiveBinding = {
    archiveSha256: zeroDigest,
    manifestDigest: zeroDigest,
    inventoryDigest: digestTemplate(members),
    members,
  };
  const target = {
    targetId: "openclaw",
    targetVersion: "replace-with-observed-version",
    targetRevision: "0".repeat(40),
    probeFingerprintDigest: zeroDigest,
    scope: "project",
    projectId: "replace-with-project-id",
  };
  const checkedPath = ".openclaw/projects/replace-with-project/AGENTS.md";
  const observations = [{
    path: checkedPath,
    parentIdentity: { device: "0", inode: "1" },
  }];
  const observedAt = "2026-01-01T00:00:00.000Z";
  const genesis = {
    schemaVersion: OPENCLAW_ABSENT_GENESIS_SCHEMA_VERSION,
    target,
    checkedPaths: [checkedPath],
    observations,
    observedAt,
    absenceObservationDigest: digestTemplate({
      target,
      checkedPaths: [checkedPath],
      observations,
      observedAt,
    }),
    verifiedAbsent: true,
    certificationBoundary: {
      observedAbsenceOnly: true,
      installed: false,
      runtime: false,
      domain: false,
      production: false,
    },
  };
  const action = {
    actionId: "process:openclaw-config-validate",
    kind: "process",
    executable: "node",
    argv: ["openclaw.mjs", "config", "validate", "--json"],
    cwd: ".openclaw/projects/replace-with-project",
    scope: "project",
    target: "openclaw:config",
    timeoutMs: 10_000,
    environmentNames: ["HOME", "OPENCLAW_CONFIG_PATH", "OPENCLAW_STATE_DIR"],
  };
  const conflict = {
    path: checkedPath,
    currentDigest: zeroDigest,
    desiredDigest: zeroDigest,
    action: "preserve",
  };
  const plan = buildOpenClawInstallPlan({
    lifecycle: "install",
    archiveBinding,
    authorityRootBinding: buildOpenClawAuthorityRootBinding({
      targetDescriptorDigest: zeroDigest,
      targetRootIdentity: { device: "0", inode: "1" },
      rootIdentity: { device: "0", inode: "2" },
    }),
    target,
    operations: [{
      path: checkedPath,
      sourcePath: "agentmo.package.json",
      operation: "write",
      configPatch: null,
      baseDigest: null,
      currentDigest: null,
      desiredDigest: zeroDigest,
      ownerMarker: "agentmo:package:replace-with-project",
      retainedFileIdentity: null,
      retainedParentIdentity: { device: "0", inode: "1" },
      conflict: "none",
      rollbackRule: "remove-if-created-and-pristine",
    }],
    sensitiveActions: [action],
    conflicts: [conflict],
    officialConfigDryRun: {
      commandDigest: zeroDigest,
      resultDigest: zeroDigest,
      accepted: true,
    },
    absentGenesis: genesis,
  });
  const decision = {
    decision: "approve",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: "2026-01-01T01:00:00.000Z",
  };
  return {
    genesis,
    plan,
    ordinary: buildOpenClawInstallApproval({
      plan,
      ...decision,
      useNonce: "replace-with-ordinary-nonce",
    }),
    sensitive: buildOpenClawSensitiveActionDecision({
      plan,
      action,
      ...decision,
      useNonce: "replace-with-sensitive-nonce",
    }),
    conflict: buildOpenClawConflictApproval({
      plan,
      conflicts: [conflict],
      ...decision,
      useNonce: "replace-with-conflict-nonce",
    }),
  };
}
