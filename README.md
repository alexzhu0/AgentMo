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
./bin/agentmo.js plan examples/win9.agentmo.json --json
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold
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
src/scaffold.js             Domain-agent scaffold generator
examples/win9.agentmo.json  Reference blueprint based on Win9-on-Pi
docs/                       Concept, lifecycle, schema, quality gates
docs/OPENCLAW_RUNTIME_NOTES.md  OpenClaw source-derived runtime notes
test/                       Node test suite
```

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

## Scripts

```bash
npm run check
```

`check` runs syntax checks and the Node test suite. No package install is required for the current MVP.
