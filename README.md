# AgentMo

AgentMo is a minimal agent-building toolkit: it records what agent should be built, plans the agent from valid data plus user needs, then scaffolds a repo-native harness for coding-agent production.

AgentMo has three explicit stages connected by artifact contracts, not mandatory command ancestry:

1. **Discover -> Discovery Contract:** materialize bounded discovery evidence through either `discover-pack` (manifest-only) or `discover-workspace` (approved local source intake).
2. **Plan -> Agent Design / Blueprint Contract:** combine a valid discovery database with `agentmo.user-need.v1` to produce `agentmo.design-plan.v1`, then draft a valid blueprint with `agentmo_version: "0.1"`, eval requirements, and evidence policy.
3. **Produce -> Delivery Evidence Contract:** accept any valid AgentMo blueprint/design contract, including externally reviewed or business-provided designs with bounded provenance, then produce handoff, scaffold, run, eval, birth, domain-eval, and delivery evidence.

The support-triage MVP is a composed vertical demo of those contracts. It is not the only valid path. The current `domain-eval` / `delivery-report` work belongs to stage 3: it closes delivery evidence after scaffold, run-state, run-eval, and birth-report exist.

See `docs/STAGE_CONTRACTS.md` for the contract matrix, allowed inputs, forbidden coupling, and independent verification commands. Echo and future close collaborators should start with the tri-party collaboration protocol in `CONTRIBUTING.md`.

AgentMo is not a chat prompt generator. It is a mechanism for building agents as software:

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
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js validate examples/win9.agentmo.json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js report examples/win9.agentmo.json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js report examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js discover-report examples/win9.discovery.json --json --digest "discovery-manifest=$(digest_file "examples/win9.discovery.json")"
./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out /tmp/support-triage-discovery --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out /tmp/support-triage-workspace-discovery --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
./bin/agentmo.js design-plan /tmp/support-triage-discovery/agentmo-discovery-db.json --need examples/support-triage.need.json --out /tmp/support-triage-design-plan.json --target openclaw --json --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")" --digest "user-need=$(digest_file "examples/support-triage.need.json")"
./bin/agentmo.js blueprint-draft /tmp/support-triage-discovery/agentmo-discovery-db.json --need examples/support-triage.need.json --design-plan /tmp/support-triage-design-plan.json --out /tmp/support-triage.agentmo.json --target openclaw --json --digest "discovery-db=$(digest_file "/tmp/support-triage-discovery/agentmo-discovery-db.json")" --digest "user-need=$(digest_file "examples/support-triage.need.json")" --digest "design-plan=$(digest_file "/tmp/support-triage-design-plan.json")"
./bin/agentmo.js handoff /tmp/support-triage.agentmo.json --target openclaw --out /tmp/support-triage-handoff --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")"
./bin/agentmo.js plan examples/win9.agentmo.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js scaffold examples/win9.agentmo.json --out /tmp/win9-agentmo-scaffold --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js scaffold examples/win9.agentmo.json --target openclaw --out /tmp/win9-openclaw-scaffold --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" --digest "build-state=$(digest_file "/tmp/win9-openclaw-scaffold/agentmo-build-state.json")"
./bin/agentmo.js observe examples/win9.observation.json --json --digest "observation=$(digest_file "examples/win9.observation.json")"
./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/workspace --agent win9 --provider deepseek --model deepseek/deepseek-v4-flash --thinking off --transport local --runtime-env-file .env --message "Say exactly: ok" --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
RUN_STATE="/tmp/support-triage-run/runs/${RUN_ID:?set RUN_ID}/agentmo-run-state.json"
./bin/agentmo.js birth-report /tmp/support-triage.agentmo.json --build-state /tmp/support-triage-scaffold/agentmo-build-state.json --run-state "$RUN_STATE" --run-eval /tmp/support-triage-run-eval.json --expect-status declared --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")" --digest "build-state=$(digest_file "/tmp/support-triage-scaffold/agentmo-build-state.json")" --digest "run-state=$(digest_file "$RUN_STATE")" --digest "run-eval=$(digest_file "/tmp/support-triage-run-eval.json")" > /tmp/support-triage-birth-report.json
./bin/agentmo.js domain-eval /tmp/support-triage.agentmo.json --cases examples/support-triage.domain-cases.json --target openclaw --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")" --digest "domain-cases=$(digest_file "examples/support-triage.domain-cases.json")" > /tmp/support-triage-domain-eval.json
./bin/agentmo.js delivery-report /tmp/support-triage.agentmo.json --build-state /tmp/support-triage-scaffold/agentmo-build-state.json --run-state "$RUN_STATE" --run-eval /tmp/support-triage-run-eval.json --birth-report /tmp/support-triage-birth-report.json --domain-eval /tmp/support-triage-domain-eval.json --json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")" --digest "build-state=$(digest_file "/tmp/support-triage-scaffold/agentmo-build-state.json")" --digest "run-state=$(digest_file "$RUN_STATE")" --digest "run-eval=$(digest_file "/tmp/support-triage-run-eval.json")" --digest "birth-report=$(digest_file "/tmp/support-triage-birth-report.json")" --digest "domain-eval=$(digest_file "/tmp/support-triage-domain-eval.json")"
```

Every durable file operand above carries one canonical `--digest` subject calculated from the exact file bytes at the invocation. AgentMo verifies that binding before JSON decode; a digest of parsed or reserialized JSON is not equivalent. Missing, duplicate, extra, mismatched, or stale bindings fail closed.

Stage 1 has two explicit paths:

- `discover-pack` is the manifest-only path. It validates an `agentmo.discovery.v1` manifest and writes `agentmo-discovery-db.json`, `facts.jsonl`, and `coverage.json` without reading the referenced local source files.
- `discover-workspace <discovery.json> --source-root <dir> --out <dir> [--json]` is the approved local source-intake path. It reads only allowed local source files referenced by the manifest under the repo-bound `--source-root`.

`discover-workspace` writes five Stage 1 artifacts:

```text
agentmo-discovery-db.json
facts.jsonl
coverage.json
source-cards.json
source-chunks.jsonl
```

Source-derived evidence enters `agentmo-discovery-db.json.facts` and `facts.jsonl` as `kind:"source_chunk"` records. `source-cards.json` and `source-chunks.jsonl` are supplemental sidecars; Stage 2 uses the discovery DB as its durable input. Unsafe workspace DBs fail closed through DB-visible validation/safety state and must not enter `design-plan` or `blueprint-draft`.

Neither Stage 1 path performs web crawling, live search, or search API collection. Do not point `--source-root` at secrets, `.env` files, parent directories, or sibling projects. Stage 1 stays decoupled: it does not call Stage 2/3 and does not write blueprint, handoff, build, run, birth, or delivery artifacts.

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
export AGENTMO_REPO="<path-to-AgentMo>"
cd "$AGENTMO_REPO"
omx --madmax --xhigh
```

Then tell the new session to read `docs/OMX_SESSION_MIGRATION.md` first. The handoff records the current AgentMo objective, dirty-tree expectations, verification commands, secret-handling rules, and the boundary that AgentMo work must not touch `pi`, `AgentHarness`, or `openclaw` unless explicitly requested.

Local agent instructions live in:

```text
AGENTS.md
```

Those instructions are the project-specific contract for future coding agents working in this repository.

## Why this exists

The Win9-on-Pi work showed a new development mode: use Codex to build another agent system on top of Pi. AgentMo captures that mode as a reusable three-stage agent-building mechanism.

- Stage 1 discovery materializes approved source inputs into structured databases or retrieval corpora; current commands use operator-provided manifests and approved local source intake rather than claiming live web crawling.
- Discovery can be recorded as an external `agentmo.discovery.v1` manifest. `discover-report` validates it, `discover-pack` materializes the manifest-only Discovery Contract, and `discover-workspace` reads approved local sources into DB-visible `source_chunk` facts plus supplemental source sidecars.
- Stage 2 planning turns a valid discovery database plus `agentmo.user-need.v1` into an auditable `agentmo.design-plan.v1`, then into an executable blueprint/design contract for the new Agent.
- Stage 3 production accepts a valid blueprint/design contract by artifact validity, not command ancestry. It may start from AgentMo Stage 2 output or from an externally reviewed/business-provided contract with bounded provenance.
- Stage 3 then uses Codex and other coding-agent runtimes to finish handoff, scaffold, runtime evidence, domain eval, and delivery reporting.
- Codex acts as the builder: reads, edits, tests, verifies, documents.
- Pi can act as the active runtime: local agents, tools, sessions, extension surface.
- OpenClaw can be recorded as an active alternate architecture profile: Gateway, channel delivery, isolated agents, session trajectories, and plugin/runtime ownership boundaries.
- AgentHarness-style control-plane ideas act as governance: policy, gates, audit, manifests.
- AgentMo ties them together through its blueprint and three-stage lifecycle.

## Quality rule

AgentMo follows one strict idea. Read these as artifact-contract rules, not as mandatory command ancestry:

```text
No valid Discovery Contract, no AgentMo-generated plan.
No valid Agent Design / Blueprint Contract, no production.
No eval, no birth.
No evidence, no release.
No tool contract, no runtime.
No governance, no production.
No version ledger, no reproduction.
```

For Stage 3, an externally reviewed or business-provided valid blueprint/design contract can satisfy the plan contract when it carries bounded provenance. That admission does not certify runtime behavior, domain-wide quality, or production approval.

## Project layout

```text
bin/agentmo.js              CLI entrypoint
src/blueprint.js            Blueprint validation and quality gates
src/report.js               AgentMo readiness report
src/build-plan.js           Deterministic dry-run operation planner
src/build-state.js          Managed scaffold sidecar state writer
src/discovery.js            Discovery manifest validation and report builder
src/discovery-db.js         Sanitized discovery pack / facts / coverage materializer
src/user-need.js            User-need brief validation and report builder
src/source-refs.js          Shared bounded source_refs validation
src/design-plan.js          Stage 2 design-plan contract builder and validator
src/blueprint-draft.js      Blueprint drafting from discovery DB plus user need/design-plan
src/handoff.js              Coding/runtime handoff package writer
src/birth-report.js         Fail-closed birth gate over build/run/eval evidence
src/domain-eval.js          Independent bounded domain-quality evidence report
src/delivery-report.js      Delivery evidence aggregation and revalidation report
src/scaffold.js             Domain-agent scaffold generator
AGENTS.md                   Local instructions for Codex/OMX agents working on AgentMo
CONTRIBUTING.md              Alex/Echo/Codex collaboration protocol, PR workflow, boundaries, and validation commands
examples/win9.agentmo.json  Reference blueprint based on Win9-on-Pi
examples/win9.discovery.json  Reference discovery/input manifest
examples/support-triage.*   MVP birth-loop fixture inputs, domain cases, and generated draft blueprint
docs/                       Concept, lifecycle, schema, quality gates
docs/OMX_SESSION_MIGRATION.md  Fresh-session handoff and ultragoal-style recovery plan
docs/AGENT_BIRTH_GATE.md    Birth-report evidence levels and fail-closed gate
docs/MVP_RUNBOOK.md         End-to-end MVP birth-loop runbook
docs/AGENTMO_MVP_LEDGER.md  MVP evidence ledger and non-certification disclosure
docs/OBSERVE_EVOLVE.md      Evidence-first observe/evolve record rules
docs/OPENCLAW_RUNTIME_NOTES.md  OpenClaw source-derived runtime notes
docs/STAGE_CONTRACTS.md     Stage artifact contracts and independent verification commands
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

`agentmo status` emits `agentmo.control.v1`: a stable control snapshot for a future UI/control pane. It includes agent status, Produce maturity, runtime profiles, certification metadata when present, pipeline completeness, quality gates, eval/evidence/release summaries, risks, and next actions.

Pass `--build-state <path>` after scaffold to attach the latest managed sidecar summary:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
./bin/agentmo.js status examples/win9.agentmo.json --build-state /tmp/win9-openclaw-scaffold/agentmo-build-state.json --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" --digest "build-state=$(digest_file "/tmp/win9-openclaw-scaffold/agentmo-build-state.json")"
```

If build state is absent or unreadable, status remains available and reports the build-state section as unavailable.

## MVP birth loop

The first executable AgentMo loop is a composed vertical demo of the three artifact contracts:

```text
discover-pack or discover-workspace -> need-report -> design-plan -> blueprint-draft -> handoff -> scaffold/run/run-eval -> birth-report -> domain-eval -> delivery-report
```

This sequence proves that the contracts compose. It does not make Stage 3 depend on the Stage 1 or Stage 2 command path when a valid blueprint/design contract is already available.

`birth-report` is fail-closed. It requires a valid blueprint, `agentmo-build-state.json`, `agentmo-run-state.json`, and a passing `agentmo.run-eval.v1` report. Declared evidence proves wiring only; `live-success` evidence from isolated live execution is required before runtime promotion. The birth report never certifies runtime parity, domain quality, or production deployment.

`domain-eval` is independent bounded case-suite evidence over supplied domain cases. When it passes, `domainCertifiedByDomainEval` means the supplied deterministic suite passed; it is not production, customer-support-wide, or domain-wide certification.

`delivery-report` revalidates and aggregates blueprint, build-state, run-state, run-eval, birth-report, and optional domain-eval artifacts. It can carry the bounded domain-eval result, but it does not create runtime certification, domain-wide quality certification, OpenClaw production readiness, or production deployment approval by itself.

See `docs/MVP_RUNBOOK.md` and `docs/AGENT_BIRTH_GATE.md`.

## Observe / evolve records

`agentmo observe` validates `agentmo.observation.v1` records. Observation records capture failure evidence, a proposed regression, and an optional blueprint-change proposal. They do not automatically mutate blueprints, tools, evals, or generated scaffolds.

`agentmo observe-run <run-state.json> --out <observation.json>` derives the same proposal-only observation shape from managed runtime evidence. It is a bridge from failed or declared run-state sidecars into reviewed observe/evolve work, not an automatic blueprint or scaffold mutation path.

## OpenClaw target

`--target openclaw` generates an OpenClaw-oriented runtime package:

AgentMo core remains Node.js `>=20`, while OpenClaw target mutation requires `>=22.19.0 <23 || >=23.11.0`. Run `node ./bin/agentmo.js runtime-check --target openclaw` before any direct OpenClaw mutation; this CLI check is authoritative and is not runtime, domain, or production certification.

`--runtime-env-file` is AgentMo's sole public runtime environment-file option. The collision-prone former spelling is intentionally not an alias because a Node launcher can consume it before AgentMo receives argv; the Bash live-smoke helper keeps its own local option. Phase 01.2 binds actual Node 20 execution to a [repository-owned distribution trust anchor](scripts/node20-distribution-trust.json), an [exact published receipt](release/evidence/2026.07.13-node20-core-receipt.json), and a [post-publication compatibility matrix](docs/RUNTIME_COMPATIBILITY.md). These are bounded mechanism records, not domain-quality or production certification.

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
npm run check &&
node ./bin/agentmo.js runtime-check --target openclaw &&
cp .env.example .env &&
# fill DEEPSEEK_API_KEY in .env; .env is gitignored and value-blind in AgentMo evidence
OPENCLAW_SOURCE_ROOT="<openclaw-source-root>" &&
scripts/openclaw-live-smoke.sh --blueprint examples/win9.agentmo.json --agent win9 --message "Say exactly: ok" --openclaw-source-root "$OPENCLAW_SOURCE_ROOT"
```

`check` runs syntax checks and the Node test suite. The OpenClaw live smoke script is optional, defaults to DeepSeek flash with `--thinking off`, uses temporary `OPENCLAW_STATE_DIR`, scaffold workspace, and run-output paths by default, refuses non-gitignored env files, reads only supported env keys, passes proxy env keys through when present without persisting their values, requires live execution success by default, and scrubs credential-bearing OpenClaw state unless `--keep-state` is explicit.
