---
phase: 02-codex-builder
plan: "15"
subsystem: codex-uat-authority
tags: [codex, uat, immutable-journal, checkpoint, hook-observation, cli, evidence-boundary]

requires:
  - phase: 02-codex-builder
    plan: "11"
    provides: Immutable checkpoint journal, unique-chain admission, and exact checkpoint digests
  - phase: 02-codex-builder
    plan: "14"
    provides: Complete runtime closure, exact I/O inventory, and immutable-checkpoint consumers
provides:
  - Sole immutable predecessor-bound Codex UAT attempt journal and complete fixed reducer
  - Head-independent opaque scenario arming with candidate-only installed-hook observation leaves
  - Candidate-leaf-first readiness and exactly one explicit human decision
  - Closed value-blind public start, scenario-arm, record, terminal, inspect, and resume CLI
affects: [codex-builder, builder-checkpoint, builder-hook-bridge, builder-behavior-eval, builder-cli, artifact-surface-coverage, packed-runtime]

tech-stack:
  added: []
  patterns:
    - Immutable exact-predecessor journal with a complete closed transition reducer
    - One-way content-addressed leaves that never reference or derive from journal state
    - Private in-process admissions for journal heads, checkpoints, and observation leaves
    - Read-only derived inspection and resume with exact-head compare-and-set mutations

key-files:
  created:
    - src/builder-codex-uat.js
    - src/builder-checkpoint.js
    - src/builder-hook-bridge.js
    - src/builder-behavior-eval.js
    - test/builder-codex-uat.test.js
    - test/builder-hook-bridge.test.js
    - test/builder-cli.test.js
    - test/builder-packed-install.test.js
    - test/codex-builder-behavior.test.js
    - .planning/phases/02-codex-builder/02-15-SUMMARY.md
  modified:
    - src/cli.js
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js

key-decisions:
  - "One immutable attempt journal is the sole UAT lifecycle authority; resume and inspection are derived and append nothing."
  - "Scenario arming uses the current head only as a compare-and-set precondition and persists a fresh opaque correlation independent of all journal bytes."
  - "Installed hook delivery may publish only a false-claim observation leaf; the later legal scenario transition alone references checkpoint and observation digests one-way."
  - "Candidate bytes exist before candidate-ready, contain no reverse journal edge, and cannot acquire host, domain, package, production, or wider-compatibility certification."
  - "Public CLI authority is a closed action set with exact request artifacts and bounded value-blind output; raw append, challenge mint, context factory, and direct semantic delivery exports do not exist."

patterns-established:
  - "Closed lifecycle matrix: exact predecessor, exact evidence, fixed scenario order, exclusive pre-candidate terminals, and one post-candidate human decision."
  - "Acyclic evidence graph: leaves are independently content-addressed and only journal successors may reference their digests."
  - "Authority by admission: semantic consumers require private loader-produced admissions rather than caller-shaped logical objects."

requirements-completed: [BLDR-03, BLDR-04, BLDR-07]

coverage:
  - id: D1
    description: "The complete activation-first attempt matrix is enforced by one immutable exact-predecessor chain, including derived-only resume and mutually exclusive terminals."
    requirement: BLDR-03
    verification:
      - kind: unit
        ref: "test/builder-codex-uat.test.js#sole immutable Codex UAT journal authority"
        status: pass
    human_judgment: false
  - id: D2
    description: "The eleven pause, compaction, restart, duplicate, upgrade, and uninstall scenarios advance only in fixed order through admitted checkpoint and observation leaves."
    requirement: BLDR-04
    verification:
      - kind: integration
        ref: "test/builder-hook-bridge.test.js#Builder installed hook observation boundary"
        status: pass
      - kind: integration
        ref: "test/builder-packed-install.test.js#packed Builder installation"
        status: pass
    human_judgment: false
  - id: D3
    description: "Installed evidence remains candidate-only and explicitly false for Codex origin, authenticated session, human observation, domain quality, package readiness, production readiness, and wider compatibility."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/codex-builder-behavior.test.js#packed fresh-process Builder behavior evaluation"
        status: pass
      - kind: integration
        ref: "test/builder-cli.test.js#builder CLI closed Codex UAT journal"
        status: pass
    human_judgment: false

duration: 52m
completed: 2026-07-20
status: complete
---

# Phase 02 Plan 15: Sole Codex UAT Journal and Honest Observation Boundary Summary

**A single immutable activation-first UAT journal now governs the complete eleven-scenario Codex flow, while installed hooks can produce only acyclic false-claim observation leaves for later human-bound admission.**

## Performance

- **Duration:** 52m
- **Started:** 2026-07-20T12:54:23Z
- **Completed:** 2026-07-20T13:45:46Z
- **Tasks:** 3
- **Files created/modified:** 13

## Accomplishments

- Replaced mutable run/final state with one bounded immutable attempt journal, exact predecessor admissions, a complete transition reducer, fixed eleven-scenario ordering, derived resume, and fail-closed fork/gap/orphan/malformed-publication handling.
- Enforced activation before fresh-process trust/auth and initial SessionStart evidence, candidate-leaf-first publication, mutually exclusive pre-candidate failure/interruption terminals, and exactly one explicit human admission or rejection.
- Removed raw public challenge/context/semantic-delivery authority and made scenario arming persist only a fresh opaque correlation independent of the journal head or predecessor.
- Limited the installed bridge to independent content-addressed observation leaves whose real-host, normal-trust, authenticated-session, human-observed, package, domain, production, and wider-compatibility claims remain false.
- Added a closed public CLI for start, scenario-arm, record, bounded terminal, inspect, and read-only resume actions with exact request digests, exact-head CAS, and value-blind output.
- Re-inventoried all five changed production modules and retained the current package, artifact, subject, command, and I/O ownership surface without skipped, disabled, filtered, or weakened tests.

## Task Commits

No commits were created. The parent execution contract explicitly prohibited staging, committing, pushing, or advancing shared planning state.

## Files Created/Modified

- `src/builder-codex-uat.js` - Sole immutable journal adapter, complete transition reducer, scenario arming/recording, candidate publication/admission, and derived resume.
- `src/builder-checkpoint.js` - Closed head-independent UAT challenge schema and immutable checkpoint admissions.
- `src/builder-hook-bridge.js` - Private installed-hook delivery authority and candidate-only false-claim observation leaf publication.
- `src/builder-behavior-eval.js` - Exact candidate admission and stable installed projection/receipt/owner/ledger validation without broader certification.
- `src/cli.js` - Closed public UAT commands, canonical request artifacts, exact-head mutation gates, bounded outputs, and updated help.
- `test/builder-codex-uat.test.js` - Full positive matrix plus hostile predecessor, ordering, terminal, publication, and immutable-chain coverage.
- `test/builder-hook-bridge.test.js` - Raw-authority namespace, head-independent correlation, one-way leaf, replay, runner, and value-blind failure coverage.
- `test/builder-cli.test.js` - Closed lifecycle, activation timing, stale-head, read-only resume, and redaction coverage.
- `test/artifact-surface-coverage.test.js`, `test/helpers/io-surface-inventory.js` - Exact incremental five-module public artifact and I/O re-inventory.
- `test/codex-builder-behavior.test.js` - Authorized migration to immutable candidate admission and the new evaluator bindings.
- `test/builder-packed-install.test.js` - Authorized packed stable-launcher scenario-arm, installed-runner observation, and later exact record integration.

## Decisions Made

- Journal state is never mirrored into a mutable final or head file; one unique predecessor-bound chain is reloaded and reduced for every authoritative decision.
- A journal head can authorize arming and later append CAS checks, but it cannot seed, encode, validate, or appear in the persisted correlation, checkpoint successor, candidate, or observation leaf.
- Candidate and observation schemas reject reverse edges and certification claims so mechanism evidence cannot self-promote into host or domain evidence.
- Installed execution authority is confined to one exported runner wrapper; context construction, raw semantic delivery, and challenge minting remain private.
- CLI mutations consume canonical exact-digest request artifacts rather than exposing an arbitrary append or entry-construction surface.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking issue] Migrated the behavior integration from removed mutable UAT APIs**
- **Found during:** Task 2 verification
- **Issue:** The behavior integration still imported mutable run/basis/final helpers that the sole-authority design intentionally removed.
- **Fix:** After explicit parent authorization, rewired the integration through the immutable journal, checkpoint/observation admissions, candidate leaf, and exact evaluator bindings without compatibility aliases.
- **Files modified:** `test/codex-builder-behavior.test.js`
- **Verification:** Behavior evaluation 5/5 and full repository 652/652.
- **Committed in:** Not committed by explicit instruction.

**2. [Rule 3 - Blocking issue] Migrated the packed install integration from raw challenge authority**
- **Found during:** Overall integration verification
- **Issue:** The packed integration still exercised the removed public raw challenge mint and embedded observation state.
- **Fix:** After explicit parent authorization, used public start/setup/activation/scenario-arm commands, the installed adjacent runner's false-claim leaf, and a later exact record that consumes admitted checkpoint/observation digests one-way.
- **Files modified:** `test/builder-packed-install.test.js`
- **Verification:** Packed install 13/13, Plan 15 combined 42/42, and full repository 652/652.
- **Committed in:** Not committed by explicit instruction.

---

**Total deviations:** 2 auto-fixed (2 Rule 3)
**Impact on plan:** Both authorized integration migrations remove obsolete authority instead of preserving aliases; they keep the packed projection, receipt, installed runner boundary, and non-certifying evidence semantics intact.

## Issues Encountered

- The first full-check stream exceeded the execution wrapper's output capture and did not retain a trustworthy final status. The gate was rerun through a `pipefail` pipeline; the upstream `npm run check` exit was 0 with 652/652 tests passing.

## TDD Gate Compliance

- RED tests were written and observed failing before each implementation slice; GREEN focused suites then passed.
- Separate RED/GREEN commits were intentionally not created because the parent execution contract prohibited every commit.

## Known Stubs

None. The scan found only internal empty accumulators, nullable lifecycle state, and explicit failure predicates; no TODO, FIXME, placeholder, mock-only UI data path, or goal-blocking unwired surface exists.

## Verification

- `node --test test/builder-codex-uat.test.js` - 8/8 pass.
- `node --test test/builder-hook-bridge.test.js test/builder-codex-uat.test.js` - 14/14 pass.
- `node --test test/codex-builder-behavior.test.js` - 5/5 pass.
- `node --test test/builder-cli.test.js` - 10/10 pass.
- `node --test test/artifact-surface-coverage.test.js` - 13/13 pass.
- `node --test test/builder-packed-install.test.js` - 13/13 pass.
- `node --test test/builder-cli.test.js test/builder-codex-uat.test.js test/builder-hook-bridge.test.js test/codex-builder-behavior.test.js test/artifact-surface-coverage.test.js` - 42/42 pass.
- `npm run check` - 652/652 pass across 70 suites; 0 failed, skipped, or todo.
- `git diff --check` - pass.

## Threat Review

- The immutable journal, checkpoint, observation, candidate, CLI, and evaluator surfaces are the planned T-02-15 trust boundaries and implement their registered mitigations or explicit origin transfer limitation.
- No unplanned endpoint, authentication path, schema trust boundary, or file-access authority was introduced; no additional threat flag is required.

## User Setup Required

None - no external service configuration or manual secret handling is required.

## Next Phase Readiness

- BLDR-03, BLDR-04, and BLDR-07 now have exact immutable lifecycle, recovery, installed observation, candidate ordering, hostile authority, disclosure, packed integration, and full-regression coverage.
- The UAT journal deliberately does not certify real Codex origin or domain quality; those boundaries remain explicit human/verifier work for the owning later plan.
- No implementation or verification blocker remains. Commits, requirements state, roadmap/state files, README, and release records intentionally remain untouched for the parent orchestrator/user.

## Self-Check: PASSED

- Summary and all listed implementation/test files exist.
- Required focused, packed integration, full repository, and whitespace verification commands passed.
- Repository search found no competing mutable UAT authority, raw public challenge mint, public context-authority factory, or direct semantic-delivery export; remaining legacy names occur only in negative namespace assertions.
- Commit verification is not applicable because commits were explicitly prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
