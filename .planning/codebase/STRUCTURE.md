# Codebase Structure

**Analysis Date:** 2026-07-10

## Directory Layout

```text
AgentMo/
├── bin/                    # Executable CLI entry point
├── src/                    # Product modules and artifact contracts
│   └── targets/            # Scaffold target adapters and operation mapping
├── test/                   # Node.js unit, contract, and CLI integration tests
├── examples/               # Reference blueprints, manifests, needs, cases, and fixtures
│   └── fixtures/           # Sanitized local-source fixtures for discovery tests/demo
├── scripts/                # Optional operational helpers
├── docs/                   # Architecture, contracts, safety, and runbooks
├── release/                # Date-based release/evidence records
├── .planning/codebase/     # GSD-generated codebase map
├── package.json            # CLI manifest, Node requirement, and check script
├── README.md               # Product overview and operator entry point
├── CONTRIBUTING.md         # Alex/Echo/Codex collaboration contract
└── AGENTS.md               # Repository-local instructions for coding agents
```

## Directory Purposes

**`bin/`:**
- Contains the eight-line executable wrapper `bin/agentmo.js`.
- Delegates to `src/cli.js` and redacts uncaught error messages.

**`src/`:**
- One kebab-case ESM module per contract or mechanism.
- Stage 1 modules: `discovery.js`, `discovery-db.js`, and `discovery-source-workspace.js`.
- Stage 2 modules: `user-need.js`, `source-refs.js`, `design-plan.js`, and `blueprint-draft.js`.
- Blueprint/control modules: `blueprint.js`, `report.js`, and `control-snapshot.js`.
- Stage 3 modules: handoff, scaffold/build state, runtime/run state, birth/domain/delivery evidence, and observation.

**`src/targets/`:**
- `registry.js` owns deterministic target lookup and validation.
- `agentmo.js` and `openclaw.js` implement built-in target adapters.
- `operations.js` converts generated file maps to managed write operations.

**`test/`:**
- Separate flat test tree; production modules are mirrored by `*.test.js` names.
- Includes focused contract tests and multi-module CLI integration tests.
- Uses temporary directories and sanitized repository fixtures; default tests do not require live provider credentials.

**`examples/`:**
- `win9.*` is the historical/reference blueprint and discovery fixture.
- `support-triage.*` is the composed MVP vertical slice.
- `examples/fixtures/support-triage/` contains approved deterministic source material and a prebuilt discovery DB.

**`scripts/`:**
- `openclaw-live-smoke.sh` is optional, credential-aware, isolated by default, and outside the deterministic core test path.

**`docs/`:**
- Contract sources of truth include `docs/STAGE_CONTRACTS.md`, `docs/MVP_RUNBOOK.md`, and `docs/AGENT_BIRTH_GATE.md`.
- Safety/runtime references include `docs/RUNTIME_EXECUTION.md`, `docs/OPENCLAW_RUNTIME_NOTES.md`, and `docs/OBSERVE_EVOLVE.md`.
- Session recovery is documented in `docs/OMX_SESSION_MIGRATION.md`.

**`release/`:**
- `release/README.md` indexes date-based evidence summaries.
- `release/YYYY.MM.DD.md` records mechanism changes, commands, hashes/status, non-certification boundaries, and remaining risk.

## Key File Locations

**Entry Points:**
- `bin/agentmo.js` - executable boundary.
- `src/cli.js` - public command router, parsers, help, and formatters.

**Contract and Pipeline Logic:**
- `src/discovery-source-workspace.js` - approved local-source intake and safety checks.
- `src/design-plan.js` - first-class Stage 2 planning contract.
- `src/blueprint.js` - blueprint validation and quality gates.
- `src/handoff.js` - implementation/runtime handoff package.
- `src/birth-report.js` and `src/delivery-report.js` - fail-closed evidence aggregation.

**Runtime and Evidence:**
- `src/runtime-plan.js` - OpenClaw command, selector, sandbox, and message provenance plan.
- `src/runtime-execution.js` - constrained child-process execution and timeout cleanup.
- `src/run-state.js` - run persistence, replay, eval, and output summaries.
- `src/secret-redaction.js` and `src/evidence-audit.js` - durable-evidence safety.

**Testing:**
- `test/stage-contracts.test.js` - independence of Discover, Plan, and Produce contracts.
- `test/design-plan.test.js` - Stage 2 evidence mapping and fail-closed behavior.
- `test/runtime-execution.test.js` and `test/runtime-replay-eval.test.js` - process and replay safety.
- `test/cli.test.js` and `test/cli-mvp.test.js` - user-facing command composition.

**Project Governance:**
- `CONTRIBUTING.md` - Echo implementation/PR workflow and Alex/Codex boundaries.
- `AGENTS.md` - local safety, validation, release, and commit rules.
- `docs/OMX_SESSION_MIGRATION.md` - current working-tree handoff and recovery evidence.

## Naming Conventions

**Files:**
- Lowercase kebab-case JavaScript and Markdown module names: `design-plan.js`, `birth-report.js`.
- Tests mirror modules as `test/<module>.test.js`.
- Durable generated artifacts use descriptive AgentMo names such as `agentmo-run-state.json`.
- Schema constants use uppercase names ending in `_SCHEMA_VERSION`.

**Directories:**
- Lowercase plural collections: `docs/`, `examples/`, `scripts/`, `targets/`, `test/`.
- Generated output directories are operator-selected and should normally live outside the repository or under `/tmp`.

## Where to Add New Code

**New artifact contract:**
- Implementation/validation/reporting: a focused module in `src/`.
- Tests: matching `test/<artifact>.test.js` plus `test/stage-contracts.test.js` if a stage boundary changes.
- Docs: update `docs/STAGE_CONTRACTS.md`, relevant runbook/ledger, README, and a date-based release record.

**New CLI command:**
- Command handler/import/parser/help: `src/cli.js`.
- Domain logic: a focused module in `src/`; do not bury the mechanism only in the router.
- Tests: focused module test plus CLI coverage in `test/cli.test.js` or `test/cli-mvp.test.js`.

**New scaffold target:**
- Adapter: `src/targets/<target>.js`.
- Registry: `src/targets/registry.js`.
- Generated content: `src/scaffold-files.js` or a new focused renderer module.
- Tests: `test/targets.test.js`, `test/build-plan.test.js`, and scaffold parity checks.

**New runtime/evidence behavior:**
- Keep planning, env resolution, execution, state, and evaluation in separate modules.
- Add negative tests proving secret/raw evidence cannot become durable or certifying.

## Special Directories

**`.planning/`:**
- GSD planning and codebase-map state.
- Newly created by this mapping run and not previously part of AgentMo's product architecture.
- Commit behavior must follow the user's later GSD configuration and the repository rule that Codex does not commit without explicit authorization.

**Generated scaffold/run directories:**
- Not fixed repository directories; runbooks use isolated `/tmp` locations.
- Build/run sidecars are evidence outputs, not source files.

---

*Structure analysis: 2026-07-10*
*Update when modules or artifact boundaries move*
