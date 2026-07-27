const NON_EMPTY_STRING = Object.freeze({ type: "string", minLength: 1 });
const NON_EMPTY_STRING_ARRAY = Object.freeze({
  type: "array",
  items: NON_EMPTY_STRING,
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

const CONTRACTS = new Map([
  [DISCOVERY_MANIFEST_CONTRACT.subject, DISCOVERY_MANIFEST_CONTRACT],
  [USER_NEED_CONTRACT.subject, USER_NEED_CONTRACT],
]);

export function getArtifactContract(subject) {
  return CONTRACTS.get(subject) ?? null;
}

export function listArtifactContractSubjects() {
  return Object.freeze([...CONTRACTS.keys()].sort());
}

export function formatArtifactContract(contract) {
  return `${JSON.stringify(contract, null, 2)}\n`;
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
