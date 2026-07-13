# AgentMo Blueprint Schema v0.1

The current MVP uses JSON to avoid dependencies. YAML can be added later as an adapter, but JSON is the canonical executable format for v0.1.

## Required top-level fields

- `agentmo_version`: must be `0.1`
- `agent_id`: lowercase kebab-case id
- `runtime`: one of `pi`, `openclaw`, `codex`, `agentharness`, `external`
- `status`: one of `draft`, `gestating`, `born`, `training`, `certified`, `released`, `deprecated`
- `domain_genome`
- `pipeline`
- `architecture`
- `tools`
- `evidence`
- `eval`
- `governance`
- `release`

## Runtime profiles

`runtime` records the current primary execution architecture. `runtime_profiles` is optional but recommended when the agent has more than one architecture lineage or target, for example Pi as the active runtime and OpenClaw as an active alternate architecture reference.

```json
[
  {
    "id": "pi",
    "role": "primary",
    "status": "active",
    "purpose": "Current verified local runtime.",
    "owned_surfaces": [".pi/agents/<agent>.md"],
    "evidence_boundaries": [".shared/<key>/"]
  },
  {
    "id": "openclaw",
    "role": "alternate",
    "status": "active",
    "purpose": "Alternate architecture source for Gateway/channel delivery, isolated agents, session trajectories, plugin hooks, and runtime ownership boundaries.",
    "owned_surfaces": ["openclaw.mjs", "src/agents/", "src/gateway/", "src/channels/"],
    "evidence_boundaries": ["Translate to active runtime before execution."],
    "source_refs": ["../openclaw@<commit>", "docs/concepts/agent-runtimes.md"],
    "transfer_rules": ["Do not confuse provider, model, runtime, and channel layers."]
  }
]
```

Allowed `role` values: `primary`, `alternate`, `legacy`, `migration_source`, `governance`, `builder`.

Allowed `status` values: `active`, `planned`, `legacy`, `experimental`, `deprecated`.

Optional runtime profile fields:

- `source_refs`: exact local paths, commits, package versions, or docs used as architecture evidence.
- `transfer_rules`: rules for porting architecture ideas across runtimes without assuming API compatibility.
- `supported_assets`: assets this runtime profile is known to support.
- `unsupported_surfaces`: runtime surfaces that are explicitly not supported or not certified.
- `install_or_onramp`: setup or promotion guidance for this runtime profile.
- `verification_commands`: commands required to validate the runtime/profile claim.
- `risk_notes`: risks that must remain visible in report/control outputs.
- `owner`: owner of the runtime profile evidence.
- `last_verified_at`: ISO-like date string for the latest verification pass.

Certification fields are optional for v0.1 compatibility. Active primary/alternate profiles that omit `verification_commands` or `unsupported_surfaces` remain valid but emit warnings, because AgentMo should disclose runtime claims without overstating parity.

## Discovery manifest pointer

`discovery_manifest_path` is optional and points to an external discovery/input manifest relative to the blueprint file:

```json
{
  "discovery_manifest_path": "win9.discovery.json"
}
```

Blueprint validation checks only that the path is a non-empty string when present. `agentmo report` loads it when possible and emits a summary/warnings. Discovery manifests are data/input manifests only; they do not select build modules or change scaffold output.

See `docs/DISCOVERY_MANIFEST.md`.

## Build plan and build state

`agentmo plan <blueprint.json> [--target agentmo|openclaw] [--json]` emits a
deterministic dry-run operation list without writing files. `agentmo scaffold`
applies the same managed domain operations and then writes
`agentmo-build-state.json` in the output root.

The build-state sidecar uses `schemaVersion: "agentmo.build.v1"` and records the
request, target/profile resolution, source blueprint metadata/hash, generated
operation summaries, and `generatedAt` timestamp. It is a managed artifact and
is not counted as a domain operation.

## Durable admission and safe carriers

Every durable artifact file is admitted under one canonical subject and one SHA-256 digest of its exact bytes before JSON decoding. Parsed, normalized, or reserialized JSON hashes are not admission authority. A valid schema or an upstream success flag cannot substitute for that subject binding.

Persisted sensitive metadata is limited to exact closed carriers:

- `SecretRef`: exactly `kind`, `source:"runtime-env"`, and a bounded environment variable `name`; it never contains the value.
- `SecretPresence`: exactly `kind`, `source`, sorted `allowedNames`/`presentNames`/`missingNames`, and `valuesPersisted:false`.
- `RedactedSummary`: exactly `kind`, `summaryKind`, `sha256`, `length`, `redactedLength`, bounded redacted `text`, and `redacted:true`.
- Runtime host paths use `TransientPathRef` with `kind`, a fixed logical `name`, and `persisted:false`; the actual path must be supplied again at execution.

Objects that resemble these carriers but add fields, use an unapproved source/name, or contain raw credential/runtime material fail closed.

## Domain genome

```json
{
  "domain": "enterprise_sales_methodology",
  "purpose": "Answer Win9 sales questions with evidence-backed action guidance.",
  "task_classes": ["methodology_lookup"],
  "knowledge_sources": ["methodology_docs"],
  "hard_failures": ["fabricate_customer_fact"]
}
```

## Pipeline

`pipeline` records AgentMo's three-stage mechanism: discover what to build, plan how to build it from data plus user needs, then produce the agent with Codex or another coding-agent runtime.

```json
{
  "discover": {
    "purpose": "Find source data, user needs, and the agent opportunity.",
    "data_sources": ["docs", "databases", "user interviews"],
    "database_outputs": ["source inventory", "retrieval corpus"],
    "user_need_inputs": ["target workflow", "users", "hard failures"],
    "done_when": ["data is bounded", "user need is concrete"]
  },
  "plan": {
    "purpose": "Turn data and user needs into a buildable agent blueprint.",
    "planning_inputs": ["database outputs", "runtime constraints"],
    "planning_outputs": ["blueprint", "tool contracts", "eval plan"],
    "decision_gates": ["no build without source data", "no release without evals"],
    "done_when": ["blueprint validates", "runtime target is explicit"]
  },
  "produce": {
    "purpose": "Use coding agents to implement, test, repair, and document the specified agent.",
    "coding_tools": ["Codex"],
    "runtime_targets": ["pi", "openclaw"],
    "generated_outputs": ["agent prompts", "tools", "runtime scaffold"],
    "verification_steps": ["unit tests", "CLI smoke", "eval benchmark"],
    "done_when": ["tests pass", "evidence is recorded"]
  }
}
```

## Architecture

```json
{
  "main_agent": "win9-main",
  "specialists": [
    { "id": "win9-step1", "purpose": "Customer profile specialist" }
  ],
  "routing_modes": ["light_lookup", "full_orchestration"]
}
```

## Tool contract

Every tool must define:

- `name`
- `purpose`
- `allowed_when`
- `forbidden_when`
- `evidence_policy`

## Evidence

Evidence is the difference between a demo agent and a verifiable agent. Required fields:

- `stores`
- `required_artifacts`
- `audit_rules`

## Eval

Required fields:

- `cases_path`
- `rubric_path`
- `required_case_classes`
- `hard_failures`

## Governance

Required fields:

- `policies`
- `quality_gates`

## Release

Required fields:

- `latest_commit` or `release_ledger_path`
- `known_risks`

## Legacy migration context

Legacy machine artifacts may contain `agentmother_version: "0.1"`. That field is accepted only by the explicit, value-blind migration path; current validators and emitters require `agentmo_version: "0.1"` and never dual-write the legacy identity.
