# AgentMother Blueprint Schema v0.1

The current MVP uses JSON to avoid dependencies. YAML can be added later as an adapter, but JSON is the canonical executable format for v0.1.

## Required top-level fields

- `agentmother_version`: must be `0.1`
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

## Build plan and build state

`agentmo plan <blueprint.json> [--target agentmo|openclaw] [--json]` emits a
deterministic dry-run operation list without writing files. `agentmo scaffold`
applies the same managed domain operations and then writes
`agentmo-build-state.json` in the output root.

The build-state sidecar uses `schemaVersion: "agentmo.build.v1"` and records the
request, target/profile resolution, source blueprint metadata/hash, generated
operation summaries, and `generatedAt` timestamp. It is a managed artifact and
is not counted as a domain operation.

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
