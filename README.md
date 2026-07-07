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
./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out /tmp/support-triage-discovery --json
./bin/agentmo.js need-report examples/support-triage.need.json --json
./bin/agentmo.js blueprint-draft /tmp/support-triage-discovery/agentmo-discovery-db.json --need examples/support-triage.need.json --out /tmp/support-triage.agentmo.json --target openclaw --json
./bin/agentmo.js handoff /tmp/support-triage.agentmo.json --target openclaw --out /tmp/support-triage-handoff --json
./bin/agentmo.js plan examples/win9.agentmo.json --json
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json
./bin/agentmo.js observe examples/win9.observation.json --json
./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/workspace --agent win9 --provider deepseek --model deepseek/deepseek-v4-flash --thinking off --transport local --env-file .env --message "Say exactly: ok" --json
./bin/agentmo.js birth-report /tmp/support-triage.agentmo.json --build-state /tmp/support-triage-scaffold/agentmo-build-state.json --run-state /tmp/support-triage-run/runs/<run_id>/agentmo-run-state.json --run-eval /tmp/support-triage-run-eval.json --expect-status declared --json
```

`plan` is a dry run: it emits deterministic managed write operations without
touching the output directory. `scaffold` applies the same domain operations and
then writes `agentmo-build-state.json` as a managed sidecar in the output root.
The sidecar records the request, target/profile resolution, source blueprint
hash, operation summaries, warnings, and generation timestamp; it is not counted
as a domain scaffold operation.

## Session recovery and current handoff

AgentMo carries a repo-local handoff for restarting Codex/OMX without relying on old chat context:

```text
docs/OMX_SESSION_MIGRATION.md
```

Use it when starting a fresh session or when work becomes mixed with sibling projects:

```bash
cd /home/alex/DTAlex/learningGitHub/AgentMo
omx --madmax --xhigh
```

Then tell the new session to read `docs/OMX_SESSION_MIGRATION.md` first. The handoff records the current AgentMo objective, dirty-tree expectations, verification commands, secret-handling rules, and the boundary that AgentMo work must not touch `pi`, `AgentHarness`, or `openclaw` unless explicitly requested.

Local agent instructions live in:

```text
AGENTS.md
```

Those instructions are the project-specific contract for future coding agents working in this repository.

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
src/discovery-db.js         Sanitized discovery pack / facts / coverage materializer
src/user-need.js            User-need brief validation and report builder
src/blueprint-draft.js      Blueprint drafting from discovery DB plus user need
src/handoff.js              Coding/runtime handoff package writer
src/birth-report.js         Fail-closed birth gate over build/run/eval evidence
src/scaffold.js             Domain-agent scaffold generator
AGENTS.md                   Local instructions for Codex/OMX agents working on AgentMo
examples/win9.agentmo.json  Reference blueprint based on Win9-on-Pi
examples/win9.discovery.json  Reference discovery/input manifest
examples/support-triage.*   MVP birth-loop fixture inputs and generated draft blueprint
docs/                       Concept, lifecycle, schema, quality gates
docs/OMX_SESSION_MIGRATION.md  Fresh-session handoff and ultragoal-style recovery plan
docs/AGENT_BIRTH_GATE.md    Birth-report evidence levels and fail-closed gate
docs/MVP_RUNBOOK.md         End-to-end MVP birth-loop runbook
docs/AGENTMO_MVP_LEDGER.md  MVP evidence ledger and non-certification disclosure
docs/OBSERVE_EVOLVE.md      Evidence-first observe/evolve record rules
docs/OPENCLAW_RUNTIME_NOTES.md  OpenClaw source-derived runtime notes
release/                    Date-based release records and evidence summaries
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

## MVP birth loop

The first executable AgentMother loop is:

```text
discover-pack -> need-report -> blueprint-draft -> handoff -> scaffold/run/run-eval -> birth-report
```

`birth-report` is fail-closed. It requires a valid blueprint, `agentmo-build-state.json`, `agentmo-run-state.json`, and a passing `agentmo.run-eval.v1` report. Declared evidence proves wiring only; `live-success` evidence from isolated live execution is required before runtime promotion. The birth report never certifies runtime parity, domain quality, or production deployment.

See `docs/MVP_RUNBOOK.md` and `docs/AGENT_BIRTH_GATE.md`.

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

## Release records

AgentMo keeps project-level release records under:

```text
release/YYYY.MM.DD.md
```

These files record milestones, design decisions, verification evidence, non-certification boundaries, and remaining risks. They are not a substitute for git tags or npm releases.

Update `release/` when AgentMo changes any durable mechanism:

- discovery, planning, or production loop behavior;
- blueprint/schema/runtime semantics;
- birth-gate or certification rules;
- runtime promotion evidence;
- session migration or handoff rules;
- major integration direction with Codex, Pi, OpenClaw, or AgentHarness.

Do not place secrets, raw transcripts, raw provider payloads, or credential-bearing runtime state in release records.

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
cp .env.example .env
# fill DEEPSEEK_API_KEY in .env; .env is gitignored and value-blind in AgentMo evidence
scripts/openclaw-live-smoke.sh --blueprint examples/win9.agentmo.json --agent win9 --message "Say exactly: ok" --openclaw-source-root /home/alex/DTAlex/learningGitHub/openclaw
```

`check` runs syntax checks and the Node test suite. The OpenClaw live smoke script is optional, defaults to DeepSeek flash with `--thinking off`, uses temporary `OPENCLAW_STATE_DIR`, scaffold workspace, and run-output paths by default, refuses non-gitignored env files, reads only supported env keys, passes proxy env keys through when present without persisting their values, requires live execution success by default, and scrubs credential-bearing OpenClaw state unless `--keep-state` is explicit.
