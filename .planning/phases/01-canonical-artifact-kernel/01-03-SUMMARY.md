---
phase: 01-canonical-artifact-kernel
plan: 03
subsystem: artifact-migration
tags: [agentmo, migration, registry, cli, value-blind, node-test]

requires:
  - phase: 01-canonical-artifact-kernel
    plan: 01
    provides: Canonical AgentMo blueprint, report, and build-state identities
provides:
  - Closed three-family legacy artifact registry with structured ordinary-loader gates
  - Deterministic, bounded, whole-batch migration preview with zero writes
  - Value-blind migration receipt model using agentmo.migration-receipt.v1
affects: [01-04, artifact-admission, persistence-safety, release-evidence]

tech-stack:
  added: []
  patterns:
    - Own-property closed-family recognition before canonical validation
    - Single-read bounded preview with ordinal-only input references
    - Registry-owned output names and digest-only receipt provenance

key-files:
  created:
    - src/artifact-registry.js
    - src/artifact-migration.js
    - test/artifact-migration.test.js
    - test/fixtures/migration/*.json
  modified:
    - src/blueprint.js
    - src/control-snapshot.js
    - src/birth-report.js
    - src/cli.js
    - src/secret-redaction.js
    - src/evidence-audit.js
    - test/cli.test.js

key-decisions:
  - "Compatibility is closed to blueprint v0.1, report v0.1, and build-state v1 legacy metadata; every other shape fails closed."
  - "Ordinary blueprint/build-state loading throws AGENTMO_MIGRATION_REQUIRED, while reports remain explicitly migrate-only."
  - "Preview plans may expose only registry-owned output names; receipts omit every basename and path."

patterns-established:
  - "Legacy gate: recognize with own properties, reject conflicts/multiple families, and never normalize during ordinary loading."
  - "Preview safety: read each input once, enforce a byte ceiling, validate the whole batch, then derive deterministic digests without writing."

requirements-completed: [CORE-02]

coverage:
  - id: D5
    description: "Supported legacy identities are recognized by a closed registry and applicable ordinary loaders return a structured migration-required error without mutation."
    requirement: CORE-02
    verification:
      - kind: unit
        ref: "test/artifact-migration.test.js#registry, own-property, transform, hostile, and loader-gate matrix"
        status: pass
      - kind: integration
        ref: "node --test test/artifact-migration.test.js test/blueprint.test.js test/control-snapshot.test.js test/birth-report.test.js test/delivery-report.test.js"
        status: pass
    human_judgment: false
  - id: D6
    description: "The migrate command produces a deterministic, value-blind, whole-batch preview and fixed receipt model while performing zero writes."
    requirement: CORE-02
    verification:
      - kind: integration
        ref: "node --test test/artifact-migration.test.js test/cli.test.js"
        status: pass
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: false

duration: 2h 03min
completed: 2026-07-12
status: complete
---

# Phase 01 Plan 03: Closed Legacy Migration Preview Summary

**AgentMo now recognizes exactly three legacy machine-artifact families, blocks implicit loading with actionable structured errors, and exposes a deterministic value-blind migration preview that never writes.**

## Performance

- **Duration:** 2h 03 min
- **Started:** 2026-07-11T17:19:59Z
- **Completed:** 2026-07-11T19:22:53Z
- **Tasks:** 2
- **Files modified:** 16, including this summary

## Accomplishments

- Added a frozen registry for blueprint v0.1, report v0.1, and build-state v1 legacy metadata with stable rule IDs, canonical transforms, and registry-owned output names.
- Wired blueprint, build-state, and build-state subject loaders to fail closed with `AGENTMO_MIGRATION_REQUIRED`; the optional status build-state path preserves that code instead of degrading it into an unavailable-state warning.
- Added a preview-only `agentmo migrate` command with bounded single reads, exact input/output byte digests, deterministic plan digests, collision detection, canonical no-ops, and whole-batch applicability.
- Added the fixed `agentmo.migration-receipt.v1` model containing only ordinals, results, identities, versions, digests, rule IDs, and bounded warning codes.
- Added negative coverage for inherited identity fields, old/new conflicts, unknown versions, multiple families, non-objects, unregistered inputs, unsafe keys/values, raw-content markers, invalid JSON, size limits, and output collisions.
- Closed six independent security-review findings covering retained-fd bounded reads, build-state dual-version admission, duplicate JSON identity members, forged receipt plans, additional raw/secret shapes, and recursion/node exhaustion.

## Verification

- Task 1 RED: the initial registry test failed with `ERR_MODULE_NOT_FOUND`; the expanded loader matrix then failed on the unwired ordinary loaders as expected.
- Task 1 GREEN: `node --test test/artifact-migration.test.js test/blueprint.test.js test/control-snapshot.test.js test/birth-report.test.js test/delivery-report.test.js` — **43/43 passed** at the Task 1 gate.
- Task 2 RED: the planner import failed with `ERR_MODULE_NOT_FOUND`, and CLI cases failed because `migrate` was not registered.
- Task 2 GREEN after security remediation: `node --test test/artifact-migration.test.js test/cli.test.js` — **35/35 passed**.
- Final repository gate: `npm run check` — **231/231 passed across 33 suites**.
- Syntax and whitespace gates: new migration modules passed `node --check`; `git diff --check` passed before summary creation.
- Write-surface scan: the planner imports read-only file access only; no migration module contains filesystem write APIs.

## Security Review Remediation

The independent security review initially returned **NO-GO** with six HIGH findings. A bounded RED/GREEN remediation round closed all six without adding apply behavior:

1. **Bounded retained-fd read:** replaced stat-then-`readFile` with a loop on the retained descriptor that reads at most `maxInputBytes + 1`, detects post-stat growth, and closes the descriptor on every path.
2. **Build-state dual-version gate:** legacy build-state admission now requires own `source.agentmotherVersion` and own `source.blueprintVersion`, both exactly `0.1`; transform removes only legacy version metadata and preserves other provenance.
3. **Duplicate identity-member gate:** added a bounded JSON lexical/parser pass before `JSON.parse` for watched top-level and build-state source members, including decoded escaped keys. Preview plus ordinary blueprint/build-state loaders reject duplicate last-wins attempts with `duplicate_identity_member`.
4. **Closed receipt validation:** `validateMigrationPlanForReceipt` enforces exact plan/item field sets, result/reason/warning enums, consecutive ordinals, registry tuples, SHA-256 digest syntax, derived counters/applicability, and a recomputed core plan digest before receipt construction.
5. **Expanded hostile-content audit:** migration auditing now rejects ordinary transcript/stdout/stderr/output storage fields and GitHub-, AWS-, and JWT-shaped values while retaining benign URL/text controls.
6. **Explicit resource budgets:** JSON identity scanning, migration auditing, transforms, and stable serialization are bounded by depth/node ceilings; per-item failures become value-blind `resource_budget_exceeded` results without aborting the rest of the batch.

Remediation RED produced **12 passing / 6 failing** migration tests, one for each finding. Focused GREEN produced **18/18 passing**, followed by the required **35/35** migration/CLI suite and **231/231** full repository gate.

## Task Commits

No commits were created. `AGENTS.md` and the executor assignment prohibit staging or committing without explicit user authorization. All changes remain unstaged and uncommitted.

The normal TDD RED/GREEN commits and final metadata commit were therefore skipped by project rule; command-level RED/GREEN evidence is recorded above.

## Files Created/Modified

- `src/artifact-registry.js` — closed recognizers, canonical transforms, structured errors, and ordinary-loader admission helper.
- `src/artifact-migration.js` — bounded reader, deterministic batch planner, plan serializer, receipt model, and human preview formatter.
- `src/blueprint.js`, `src/control-snapshot.js`, `src/birth-report.js` — migration-required gates at applicable ordinary and subject loader boundaries.
- `src/cli.js` — preview-only `migrate` command, parsing, help, JSON/human output, and optional build-state error preservation.
- `src/secret-redaction.js`, `src/evidence-audit.js` — migration-specific key/value/raw-content audit returning bounded reason codes only.
- `test/artifact-migration.test.js`, `test/cli.test.js`, `test/fixtures/migration/*.json` — unit, batch, loader, receipt, and CLI regression coverage.

## Decisions Made

- Kept canonical validation behavior separate from migration content auditing: ordinary canonical loaders preserve existing validator diagnostics, while the explicit migration planner audits canonical no-op inputs before accepting them.
- Represented report ordinary loading as `migrate_only`; no general report loader was invented for this plan.
- Kept safe registry-owned output names in preview plans for collision review, but omitted all basenames and paths from the receipt model.
- Rejected `--out` explicitly because apply, destination ownership, and persistence safety remain outside Plan 03.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Preserved canonical invalid-blueprint validator behavior**

- **Found during:** Task 1 repository gate
- **Issue:** The first loader wiring applied migration-specific content auditing to canonical blueprints before their established validator, changing a fail-closed CLI diagnostic path.
- **Fix:** Canonical ordinary loading now performs identity/version admission without the migration content audit; explicit migration preview still audits canonical no-op inputs.
- **Files modified:** `src/artifact-registry.js`
- **Verification:** Focused handoff/loader suites passed, followed by the final 225-test repository gate.
- **Commit:** skipped by project rule

**Total deviations:** 1 auto-fixed Rule 1 bug.
**Impact on plan:** The fix preserves existing canonical behavior without broadening migration scope or weakening hostile legacy/preview rejection.

## Safety Boundaries Preserved

- No source file is overwritten, no destination is created, and `--out` apply is not implemented.
- Plans and errors contain no input path, input basename, original content, raw transcript/output material, or credential-shaped value.
- Receipt fields are fixed and value-blind; output names appear only in the review plan and are registry-owned constants.
- Unknown versions, conflicting identities, multiple families, unsafe content, non-objects, and unregistered inputs are never guessed or transformed.
- No general artifact admission/persistability layer, Node runtime gate, OpenClaw runtime mutation gate, or release certification behavior was added.

## Issues Encountered

- The initial report fixture used the wrong version field and was corrected to match the actual v0.1 report writer before the loader/transform gate was declared green.
- The first repository gate exposed the canonical loader regression documented above; the focused regression suite and full repository suite passed after correction.
- Pre-existing unrelated working-tree changes, including the existing secret-example deletion and ignore-file edit, were preserved untouched.

## Known Stubs

None. Apply mode is an explicit phase boundary, not an unfinished preview path.

## User Setup Required

None — no external service, credential, or runtime setup is required.

## Next Phase Readiness

- Plan 04 can consume the closed registry and preview contract without relying on hidden loader normalization.
- Phase 1.1 retains exact-byte admission, general persistence safety, and cross-process handoff work.
- Phase 1.2 retains Node/OpenClaw runtime and release-evidence gates.

## Self-Check: PASSED

- Registry, planner, tests, fixtures, loader wiring, CLI preview, and this summary exist.
- Both task-level targeted suites, all six security regressions, and the final 231-test repository gate passed.
- No staging, commits, state/roadmap/requirements edits, branch changes, or worktree creation occurred.

---
*Phase: 01-canonical-artifact-kernel*
*Completed: 2026-07-12*
