# AgentMo

AgentMo is a minimal **AgentMother** toolkit: it finds what agent should be built, plans the agent from data plus user needs, then scaffolds a repo-native harness for coding-agent production.

AgentMother is not a chat prompt generator. It is a mechanism for building agents as software:

```text
Discover what to build
+ plan from data and user needs
+ produce with Codex / coding agents
+ domain genome
+ agent architecture
+ tool contracts
+ runtime harness
+ eval suite
+ evidence ledger
+ governance gates
= reproducible domain agent
```

## Current MVP

AgentMo currently provides a dependency-free Node CLI:

```bash
./bin/agentmo.js validate examples/win9.agentmo.json
./bin/agentmo.js report examples/win9.agentmo.json
./bin/agentmo.js report examples/win9.agentmo.json --json
./bin/agentmo.js discover-report examples/win9.discovery.json --json
./bin/agentmo.js plan examples/win9.agentmo.json --json
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json
./bin/agentmo.js observe examples/win9.observation.json --json
./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/workspace --agent win9 --transport local --message "Say exactly: ok" --json
```

`plan` is a dry run: it emits deterministic managed write operations without
touching the output directory. `scaffold` applies the same domain operations and
then writes `agentmo-build-state.json` as a managed sidecar in the output root.
The sidecar records the request, target/profile resolution, source blueprint
hash, operation summaries, warnings, and generation timestamp; it is not counted
as a domain scaffold operation.

## Why this exists

The Win9-on-Pi work showed a new development mode: use Codex to build another agent system on top of Pi. AgentMo captures that mode as a reusable three-stage mother mechanism.

- Discovery finds source data, forms structured databases or retrieval corpora, and captures user needs.
- Discovery can be recorded as an external `agentmo.discovery.v1` manifest; `discover-report` validates and summarizes it.
- Planning turns discovered data plus user needs into an executable blueprint.
- Production uses Codex and other coding-agent runtimes to generate, test, repair, and document the specified agent.
- Codex acts as the builder: reads, edits, tests, verifies, documents.
- Pi can act as the active runtime: local agents, tools, sessions, extension surface.
- OpenClaw can be recorded as an active alternate architecture profile: Gateway, channel delivery, isolated agents, session trajectories, and plugin/runtime ownership boundaries.
- AgentHarness-style control-plane ideas act as governance: policy, gates, audit, manifests.
- AgentMo ties them together as a blueprint and lifecycle.

## Quality rule

AgentMo follows one strict idea:

```text
No discovery, no plan.
No plan, no production.
No eval, no birth.
No evidence, no release.
No tool contract, no runtime.
No governance, no production.
No version ledger, no reproduction.
```

## Project layout

```text
bin/agentmo.js              CLI entrypoint
src/blueprint.js            Blueprint validation and quality gates
src/report.js               AgentMother readiness report
src/build-plan.js           Deterministic dry-run operation planner
src/build-state.js          Managed scaffold sidecar state writer
src/discovery.js            Discovery manifest validation and report builder
src/scaffold.js             Domain-agent scaffold generator
examples/win9.agentmo.json  Reference blueprint based on Win9-on-Pi
examples/win9.discovery.json  Reference discovery/input manifest
docs/                       Concept, lifecycle, schema, quality gates
docs/OBSERVE_EVOLVE.md      Evidence-first observe/evolve record rules
docs/OPENCLAW_RUNTIME_NOTES.md  OpenClaw source-derived runtime notes
test/                       Node test suite
```


## Build plans

`agentmo plan` compiles a valid blueprint into deterministic dry-run operations without writing files. The plan is the shared source of truth for scaffold apply, so dry-run and generated domain files stay in parity.

Plan JSON includes:

- `selectedTargetId`: explicit `--target` or the default `agentmo`.
- `selectedProfileId`: the matching runtime profile, primary fallback, or `null` with a stable warning.
- `selectedModuleIds`: currently always `["default"]`.
- `warnings`: sorted machine-readable warnings.
- `domainOperationCount` and `operations[]`: managed `write-file` operations keyed by `relativePath`.

## Control status snapshots

`agentmo status` emits `agentmo.control.v1`: a stable control snapshot for a future UI/control pane. It includes agent status, lifecycle stage, runtime profiles, certification metadata when present, pipeline completeness, quality gates, eval/evidence/release summaries, risks, and next actions.

Pass `--build-state <path>` after scaffold to attach the latest managed sidecar summary:

```bash
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json
```

If build state is absent or unreadable, status remains available and reports the build-state section as unavailable.

## Observe / evolve records

`agentmo observe` validates `agentmo.observation.v1` records. Observation records capture failure evidence, a proposed regression, and an optional blueprint-change proposal. They do not automatically mutate blueprints, tools, evals, or generated scaffolds.

`agentmo observe-run <run-state.json> --out <observation.json>` derives the same proposal-only observation shape from managed runtime evidence. It is a bridge from failed or declared run-state sidecars into reviewed observe/evolve work, not an automatic blueprint or scaffold mutation path.

## OpenClaw target

`--target openclaw` generates an OpenClaw-oriented runtime package:

```text
openclaw/
  workspace/
    AGENTS.md
    SOUL.md
    USER.md
    TOOLS.md
    IDENTITY.md
    skills/<agent_id>/SKILL.md
    memory/README.md
  config/openclaw.agent.patch.json
  RUNBOOK.md
  runtime_contract.md
```

The generated target is not automatically certified. Run evals and record evidence before changing the blueprint's primary runtime to `openclaw`.

## Runtime certification and discovery

Runtime profiles can include optional certification metadata:

- `supported_assets`
- `unsupported_surfaces`
- `install_or_onramp`
- `verification_commands`
- `risk_notes`
- `owner`
- `last_verified_at`

Active runtime profiles without verification commands or unsupported-surface disclosure remain valid but produce warnings. The reference OpenClaw profile is an active alternate architecture reference, not a certified Win9 runtime.

Blueprints can also set `discovery_manifest_path`; `agentmo report` loads the manifest and includes a bounded discovery summary when available. Use `agentmo discover-report <discovery.json> --json` to validate a manifest directly.

## Scripts

```bash
npm run check
scripts/openclaw-live-smoke.sh --blueprint examples/win9.agentmo.json --agent win9 --message "Say exactly: ok"
```

`check` runs syntax checks and the Node test suite. The OpenClaw live smoke script is optional, uses temporary `OPENCLAW_STATE_DIR` and workspace paths by default, and is not part of mandatory checks.
