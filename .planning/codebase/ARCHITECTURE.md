# Architecture

**Analysis Date:** 2026-07-10

## Pattern Overview

**Overall:** Contract-first, file-artifact CLI with a three-stage AgentMother pipeline and pluggable scaffold targets.

**Key Characteristics:**
- One dependency-free Node.js executable with explicit subcommands.
- `Discover -> Plan -> Produce` stages are connected by validated artifacts, not mandatory command ancestry.
- Pure builders/validators are separated from file-writing and process-execution boundaries where practical.
- Evidence and certification semantics are fail-closed and non-self-certifying.
- Runtime and scaffold targets are selected through a minimal adapter registry.

## Conceptual Layers

**CLI Boundary:**
- Purpose: parse arguments, load artifacts, invoke application functions, and format human/JSON output.
- Contains: `bin/agentmo.js` and the command dispatcher/parsers/formatters in `src/cli.js`.
- Depends on: all application modules.
- Error boundary: `bin/agentmo.js` redacts fatal error text before setting a failing exit code.

**Artifact Contract Layer:**
- Purpose: define schema versions, validation rules, summaries, and quality gates.
- Contains: `src/discovery.js`, `src/user-need.js`, `src/design-plan.js`, `src/blueprint.js`, `src/observation.js`, and evidence-report modules.
- Pattern: each durable artifact has a schema constant plus validator/builder/report functions.
- Failure model: invalid or unsafe inputs block downstream artifact construction.

**Stage 1 — Discover:**
- Manifest-only path: `src/discovery.js` -> `src/discovery-db.js`.
- Approved local-source path: `src/discovery.js` -> `src/discovery-source-workspace.js` -> discovery DB plus source sidecars.
- Safety: repo-bound roots, denied secret/certificate filenames, bounded extensions/chunks, path and content redaction.
- Output contract: discovery DB, facts, and coverage; workspace intake adds source cards and chunks.

**Stage 2 — Plan:**
- Input: valid discovery DB plus `agentmo.user-need.v1`.
- Flow: `src/user-need.js` -> `src/design-plan.js` -> `src/blueprint-draft.js` -> `src/blueprint.js` validation.
- Shared bounded provenance validation lives in `src/source-refs.js`.
- `agentmo.design-plan.v1` records requirement/evidence mapping, gaps, eval plans, governance gates, and an explicit non-certification boundary.

**Stage 3 — Produce:**
- Admission boundary: any valid blueprint/design contract, including bounded externally reviewed provenance; Stage 1 command ancestry is not required.
- Handoff/scaffold: `src/handoff.js`, `src/build-plan.js`, `src/scaffold-files.js`, `src/scaffold.js`, and `src/build-state.js`.
- Runtime evidence: `src/runtime-plan.js`, `src/runtime-env.js`, `src/runtime-execution.js`, and `src/run-state.js`.
- Closure evidence: `src/birth-report.js`, `src/domain-eval.js`, and `src/delivery-report.js`.

**Target Adapter Layer:**
- Purpose: translate a validated blueprint into deterministic write operations for a selected target.
- Registry: `src/targets/registry.js`.
- Built-in targets: `src/targets/agentmo.js` and `src/targets/openclaw.js`.
- Shared operation shape: `src/targets/operations.js`.

**Safety and Evidence Layer:**
- `src/secret-redaction.js` redacts secret-like text and host absolute paths and rejects denied durable locations.
- `src/evidence-audit.js` detects forbidden raw evidence markers and secret-like values.
- Evidence-level distinctions are preserved: declared wiring, live-success runtime execution, bounded domain-case results, and production approval are separate claims.

## Data Flow

**AgentMo-generated project path:**

1. Operator supplies a discovery manifest and approved sources.
2. Stage 1 materializes `agentmo.discovery-db.v1` plus bounded evidence sidecars.
3. A validated `agentmo.user-need.v1` describes tasks, success criteria, failures, and source refs.
4. Stage 2 creates `agentmo.design-plan.v1`, then drafts and validates `agentmo.design-contract.v1` provenance inside a blueprint.
5. Stage 3 creates a coding/runtime handoff and deterministic scaffold build plan.
6. Optional explicit runtime execution writes bounded run state and replay evidence.
7. Run eval and fail-closed birth report assess mechanism/runtime evidence.
8. Independent domain cases may add bounded case-suite evidence.
9. Delivery report revalidates and aggregates evidence without inventing certification.

**Externally reviewed design path:**

1. A business-provided blueprint enters Stage 3 only after `src/blueprint.js` validates bounded external-reviewed provenance.
2. Handoff, scaffold, runtime, and evidence steps are identical from that contract boundary onward.

**Observe/evolve path:**

1. `src/run-observation.js` derives an `agentmo.observation.v1` proposal from run evidence.
2. `src/observation.js` validates and reports it.
3. The proposal never mutates blueprint, scaffold, runtime, or eval artifacts automatically.

**State Management:**
- File-based and explicit; there is no database or daemon.
- Build and run indexes are managed sidecars.
- Each CLI invocation reconstructs state from supplied artifacts.

## Key Abstractions

**Artifact contract:** versioned JSON shape with validation, report, and certification boundary.

**Target adapter:** object with `id`, `runtimeId`, support metadata, and `planOperations()`.

**Managed write operation:** deterministic `write-file` description consumed by dry-run planning and scaffold application.

**Evidence gate:** named checks producing pass/fail details while preserving claim boundaries.

**Runtime identity:** decomposed execution metadata rather than one opaque runtime label.

## Entry Points

**CLI executable:**
- Location: `bin/agentmo.js`.
- Trigger: installed `agentmo` command or `node ./bin/agentmo.js`.
- Responsibility: delegate to `src/cli.js` and redact uncaught error messages.

**Command router:**
- Location: `src/cli.js`.
- Responsibility: implement all public commands, argument parsing, help, and output formatting.

**Optional live helper:**
- Location: `scripts/openclaw-live-smoke.sh`.
- Responsibility: orchestrate an isolated OpenClaw live smoke with value-blind evidence and cleanup.

## Error Handling

**Strategy:** validate early, throw at construction/I/O boundaries, catch once at the executable boundary, and set non-zero exit codes for failed reports.

**Patterns:**
- Validators accumulate explicit `errors`, `warnings`, and gate results.
- Builders throw when required upstream contracts are invalid or unsafe.
- Runtime operations require explicit live and state-scope opt-ins.
- Durable reports re-audit their inputs rather than trusting upstream `ok` flags.

## Cross-Cutting Concerns

**Validation:** hand-written deterministic validators; no external schema framework.

**Security:** env-value blindness, bounded source refs, path redaction, denied durable locations, constrained child-process environment, and raw-evidence rejection.

**Collaboration:** per `CONTRIBUTING.md`, Alex owns product/merge decisions, Echo owns implementation/tests/PRs, and Codex owns planning/review/docs/release assistance.

**Release evidence:** code, tests, docs, and `release/YYYY.MM.DD.md` must remain synchronized when durable mechanism semantics change.

---

*Architecture analysis: 2026-07-10*
*Update when stage contracts, target adapters, or evidence semantics change*
