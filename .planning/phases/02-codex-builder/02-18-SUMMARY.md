---
phase: 02-codex-builder
plan: "18"
subsystem: codex-uat-authority
tags: [codex, uat, immutable-journal, evidence-admission, packed-verifier, fail-closed]

requires:
  - phase: 02-codex-builder
    plan: "17"
    provides: Verifier-inclusive releases, immutable candidate publication, and bounded failed actual attempt
provides:
  - Transition-specific UAT operations derived from exact package, receipt, checkpoint, host, observation, or terminal evidence
  - Module-private journal append authority with no public raw details transition
  - One atomic packed verifier preview/decision operation that derives its own verifier digest
  - Direct-import, child-process, CLI, installed-hook, behavior, and packed hostile regressions
affects: [codex-builder, codex-uat, packed-verifier, phase-02-verification, plan-02-23-inventory]

tech-stack:
  added: []
  patterns:
    - Derive journal details only after reloading exact evidence at the transition boundary
    - Keep human trust/auth observations explicitly non-cryptographic and value-blind
    - Combine packed verifier inspection and one-shot decision under one self-checking operation

key-files:
  created:
    - .planning/phases/02-codex-builder/02-18-SUMMARY.md
  modified:
    - src/builder-codex-uat.js
    - src/cli.js
    - scripts/verify-codex-uat-candidate.js
    - test/builder-codex-uat.test.js
    - test/builder-cli.test.js
    - test/builder-packed-install.test.js
    - test/codex-builder-behavior.test.js
    - test/builder-hook-bridge.test.js

key-decisions:
  - "Keep the low-level immutable journal appender private and expose only evidence-derived transition operations."
  - "Reject caller-supplied verifier identity; the atomic decision operation hashes the fixed verifier in the admitted package itself."
  - "Persist only portable request-relative evidence references at the CLI boundary, resolving them locally before evidence admission."
  - "Leave the canonical static I/O inventory reconciliation to Plan 02-23 exactly as required by this plan."

patterns-established:
  - "Preview is read-only; approve/reject revalidates package, tarball, manifest, verifier, journal, and candidate before one CAS append."
  - "Complete-history fixtures are built through legal evidence-derived operations, never fabricated raw journal details."

requirements-completed: []

coverage:
  - id: CR-01
    description: "Raw transition authority is absent from the production module namespace and all complete histories use closed operations."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/builder-codex-uat.test.js#keeps raw append authority unavailable to a direct-import child process"
        status: pass
    human_judgment: false
  - id: CR-02
    description: "Only the self-verifying packed operation can append one human decision; caller-selected identity and hostile evidence append nothing."
    requirement: BLDR-07
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#builds verifier-inclusive disposable releases and admits only one exact successor decision"
        status: pass
    human_judgment: false

duration: 52min
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 18: Close UAT Transition and Decision Authority Summary

**Raw UAT append/inspect/decide authority is removed; exact evidence-derived transitions and one atomic packed self-verifier now own every legal history and human-decision append.**

## Performance

- **Duration:** 52 min
- **Completed:** 2026-07-21
- **Tasks:** 3/3 complete
- **Commits:** none — 未提交（项目合约）
- **Planning state:** intentionally unchanged by execution contract

## Accomplishments

- Made the raw journal append primitive module-private and replaced it with `startCodexUatAttempt`, `recordCodexUatSetupApplied`, `recordCodexUatActivationApplied`, `recordCodexUatTrustAuthObservation`, and `terminateCodexUatAttempt`.
- Removed the public `appendCodexUatAttemptEntry`, `inspectCodexUatCandidateForHumanDecision`, and `decideCodexUatCandidate` authority surfaces.
- Added `verifyCodexUatCandidateDecision`, which reads the exact package inventory, tarball, release manifest, fixed verifier bytes, current journal, and candidate; derives `verifierDigest`; previews without writing; and revalidates before at most one decision append.
- Reduced `scripts/verify-codex-uat-candidate.js` to a bounded CLI over the atomic operation. Its argument surface no longer accepts `--expected-verifier-sha256`.
- Migrated CLI and every full-history fixture to legal evidence-derived operations using real disposable package, receipt, checkpoint, host-observation, human-observation, and scenario-leaf evidence.
- Added same-process and child-process direct-import regressions plus byte-for-byte journal snapshots for caller-selected verifier identity, stale head/candidate, alternate tarball, tampered verifier, and repeated decision cases.

## Task Outcomes and Commits

No commits were created. The execution contract prohibited staging, committing, pushing, tagging, stashing, branch switching, and shared planning-state updates.

1. **Task 1: Reproduce raw transition and decision bypasses** — complete. The namespace regression failed against the old export, then passed after API closure; commits: none.
2. **Task 2: Replace generic append with evidence-derived transitions** — complete. All production callers and complete-history fixtures use legal operations; commits: none.
3. **Task 3: Make packed verification the decision authority** — complete. Preview/decision is atomic and verifier-derived; commits: none.

## Public Authority Surface

The new transition-specific public operations are:

- `startCodexUatAttempt`
- `recordCodexUatSetupApplied`
- `recordCodexUatActivationApplied`
- `recordCodexUatTrustAuthObservation`
- `terminateCodexUatAttempt`
- `verifyCodexUatCandidateDecision`

Repository-wide inspection found the three removed names only as forbidden-name strings in `test/builder-codex-uat.test.js`; no production or test consumer imports or invokes them. Legal production consumers are `src/cli.js` for transitions and `scripts/verify-codex-uat-candidate.js` for the atomic packed decision. The remaining `--expected-verifier-sha256` references belong only to the distinct pre-uninstall continuation contract, not to human-decision authority.

## Exact I/O and Import Delta for Plan 02-23

Plan 02-23 must perform the single canonical inventory reconciliation. Plan 02-18 intentionally did not edit `test/helpers/io-surface-inventory.js` or `test/artifact-surface-coverage.test.js`.

### Semantic read/write delta

- `src/builder-codex-uat.js` now imports `loadBuilderPackage` and `readBoundedNoFollowFile` from `src/builder-package.js`.
- Attempt genesis reads both exact package roots and both exact tarball byte streams, deriving package name, version, release digest, and tarball digest.
- Setup admission reads canonical activated receipt bytes plus an authentic checkpoint admission and derives setup/activation authority fields rather than accepting details.
- Activation admission reloads the exact receipt and checkpoint and hashes exact host-observation bytes.
- Trust/auth and failure/interruption transitions hash exact bounded evidence files; trust/auth retains `human-observed-no-cryptographic-origin`.
- The atomic verifier reads the package root, fixed release manifest, fixed verifier asset, exact successor tarball, complete current journal, and exact candidate. Preview writes nothing; approve/reject can publish only one immutable journal successor.
- `scripts/verify-codex-uat-candidate.js` removed direct package/manifest/verifier/tarball inspection imports and now imports only `verifyCodexUatCandidateDecision` from the UAT module for authority.
- `src/cli.js` imports only the narrow transition operations. Durable record requests contain portable relative evidence references; local resolution rejects absolute paths, `..`, empty segments, and extra authority fields.
- No new network, authentication, schema, cleanup, or mutable repair surface was added. Existing immutable journal publication remains the only durable write path.

### Static inventory row movement observed by the repository scanner

- `scripts/verify-codex-uat-candidate.js`: managed writer moved from line 194 to line 88.
- `src/builder-codex-uat.js`: existing journal I/O rows moved `1196→1461`, `1200→1465`, `1207→1472`, `1230→1495`, `1231→1496`, `1232→1497`, `1239→1504`, `1240→1505`, `1339→1604`, and `1349→1614`; kinds/callees are unchanged.
- `src/cli.js` early durable-loader rows moved `425→429`, `450→454`, `455→459`, `538→542`, `543→547`, `569→573`, `574→578`, `580→584`, `609→613`, `634→638`, `665→669`, `677→681`, `693→697`, `767→771`, `771→775`, `776→780`, `781→785`, `806→810`, `810→814`, `829→833`, `833→837`, `838→842`, `843→847`, `849→853`, `861→865`, and `910→914`.
- `src/cli.js` later rows moved `1746→1808`, `1758→1820`, `1771→1833` for persistable output; `1849→1911`, `1853→1915`, `1857→1919`, `1861→1923` for process output; and `2726→2788`, `2752→2814` for bounded file reads.

## Decisions Made

- Exact evidence is reloaded inside each transition so callers cannot convert structurally valid details into authority.
- Activated receipts must match their supplied digest, canonical bytes, schema, baseline identity, and host-activation fields before contributing details.
- The verifier operation rejects unknown fields, including a caller-provided `verifierDigest`, before any append.
- Human trust/auth evidence remains explicitly non-cryptographic; this change closes application authority but does not claim Codex origin.
- The terminated actual Plan 02-17 attempt and its journal-chain files were not opened for write, resumed, repaired, deleted, or reinterpreted.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Kept durable evidence references portable**
- **Found during:** Task 2 CLI regression migration.
- **Issue:** Persisting absolute temporary evidence paths would violate the repository's durable host-path boundary.
- **Fix:** Record requests persist relative references and resolve them only at the local CLI admission boundary, rejecting traversal and absolute paths.
- **Files modified:** `src/cli.js`, `test/builder-cli.test.js`, `test/builder-packed-install.test.js`.
- **Commit:** none by execution contract.

**2. [Rule 3 - Blocking] Rebuilt complete-history fixtures through actual disposable evidence**
- **Found during:** Tasks 1 and 2 fixture migration.
- **Issue:** Former fixtures reached candidate-ready by fabricating raw details; the closed API correctly made those histories impossible.
- **Fix:** Fixtures now build distinct disposable releases, canonical receipts, authentic checkpoints, exact host/trust evidence, and legal scenario arms/observations.
- **Files modified:** all five focused test files.
- **Commit:** none by execution contract.

**3. [Rule 2 - Missing critical functionality] Required canonical activated receipt bytes**
- **Found during:** Final evidence-admission audit.
- **Issue:** Digest and JSON-shape validation alone would admit a non-canonical serialization of an otherwise matching receipt.
- **Fix:** `loadActivatedReceipt` now compares the captured bytes with canonical serialization before deriving transition details.
- **Files modified:** `src/builder-codex-uat.js`.
- **Commit:** none by execution contract.

**Total deviations:** 3 auto-fixed; no architectural expansion.

## Deferred Issues

- `npm run check` reports exactly two failures in the artifact/output surface inventory: the whole-repository snapshot and the Wave 16/17 closure snapshot. All syntax checks pass and 658/660 tests pass across 70 suites. The only diffs are the exact static row movements listed above.
- This is the explicit Plan 02-23 inventory handoff required by Task 3, not an unclassified production failure. Updating the canonical inventory in Plan 02-18 would duplicate the planned single reconciliation.

## Authentication Gates

None. No real Codex process, private locator, network access, or credential path was used.

## Known Stubs

None. The modified files contain no TODO, FIXME, placeholder, coming-soon, or goal-blocking unwired data path.

## Verification

- RED namespace regression — failed against the reviewed raw export as intended before production edits.
- `node --test test/builder-codex-uat.test.js` — 12/12 pass, including child-process direct import and caller-selected verifier rejection.
- Focused plan gate — 49/49 pass across 8 suites.
- JavaScript syntax checks for the three modified production/script files — pass.
- `npm run check` — syntax pass; 658/660 tests pass across 70 suites; only the two planned 02-23 inventory snapshots fail.
- Repository-wide old-authority search — no legal consumer; removed names appear only in negative regression strings.
- Verifier CLI authority search — no expected/caller verifier digest input; `verifierDigest` appears only in bounded preview output.
- Stub scan — no matches.
- `git diff --check` — pass.

## Certification Boundary

This plan proves closed application authority and deterministic mechanism behavior only. It does not prove cryptographic Codex origin, real Codex activation, real session behavior, domain quality, package certification, production readiness, deployment approval, or wider Codex/OpenClaw compatibility. All false certification fields and D-29 wording remain unchanged.

## User Setup Required

None for this mechanism closure. A future real UAT still requires separate human authorization and must not reuse or modify the terminated Plan 02-17 attempt.

## Next Phase Readiness

CR-01 and CR-02 are closed. Plan 02-23 has an exact, bounded inventory reconciliation list and can update the two canonical static snapshots without rediscovering authority semantics.

## Self-Check: PASSED

- All eight planned production/test files exist and the summary exists.
- All six named legal public operations exist; the three removed names have no production consumer.
- Focused verification and whitespace checks pass.
- The only repository-wide failures are the two explicitly deferred Plan 02-23 inventory snapshots documented with exact row deltas.
- Commit lookup is not applicable because commits were prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-21*
