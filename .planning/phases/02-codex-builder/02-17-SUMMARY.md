---
phase: 02-codex-builder
plan: "17"
subsystem: codex-uat-verifier
tags: [codex, uat, packed-release, immutable-journal, verifier, fail-closed]

requires:
  - phase: 02-codex-builder
    plan: "15"
    provides: Immutable activation-first UAT journal and fixed scenario authority
  - phase: 02-codex-builder
    plan: "16"
    provides: Packed pre-uninstall continuation and leaf-first candidate publication
provides:
  - Verifier-inclusive distinct baseline/successor UAT release builder
  - Fresh-extraction-only candidate preview and exact one-shot decision boundary
  - One actual immutable attempt ending in the first bounded setup rollback failure
  - Value-blind README and release evidence for the failed outcome
affects: [codex-builder, codex-uat, builder-package, phase-02-verification]

tech-stack:
  added: []
  patterns:
    - Build and fixture-test the standalone verifier before any actual UAT bytes exist
    - Bind package, version, release, tarball, manifest, continuation, and executing verifier identities
    - End the unique chain at the first pre-candidate failure without retry or replacement

key-files:
  created:
    - scripts/build-builder-uat-releases.js
    - scripts/verify-codex-uat-candidate.js
    - release/2026.07.20.md
    - .planning/phases/02-codex-builder/02-17-SUMMARY.md
  modified:
    - src/builder-codex-uat.js
    - src/builder-codex-uat-continuation.js
    - src/builder-package.js
    - package.json
    - README.md
    - test/builder-codex-uat.test.js
    - test/builder-packed-install.test.js
    - test/artifact-surface-coverage.test.js
    - test/helpers/io-surface-inventory.js
    - test/builder-package-security.test.js
    - test/builder-lifecycle.test.js
    - test/builder-codex-host.test.js

key-decisions:
  - "Use the same canonical agentmo package name with distinct semantic baseline/successor versions and independently bound release/tarball identities."
  - "Accept only scripts/verify-codex-uat-candidate.js as the manifest verifier path; retain no compatibility alias and never execute the verifier from continuation."
  - "Treat AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED as the first legal terminal, append it once, and do not start Codex or create another attempt."
  - "Mark plan execution complete because its bounded failure branch was recorded, while leaving Phase 2, UAT, and every broad certification incomplete."

patterns-established:
  - "Verifier preview is read-only; decision revalidates every preview binding and can append at most one successor."
  - "Actual UAT artifacts are created only after focused, artifact-surface, full, and diff gates pass."
  - "A lawful failure terminal completes evidence recording but cannot satisfy the phase goal."

requirements-completed: []

coverage:
  - id: D1
    description: "Distinct verifier-inclusive releases and the fresh-extraction preview/decision mechanism are exact-admitted and hostile-case tested."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#builds verifier-inclusive disposable releases and admits only one exact successor decision"
        status: pass
      - kind: unit
        ref: "test/builder-codex-uat.test.js#publishes an acyclic candidate leaf before candidate-ready and allows one exact human decision"
        status: pass
    human_judgment: false
  - id: D2
    description: "The actual normal-trust lifecycle UAT reaches activation, eleven scenarios, candidate-ready, and one exact human decision."
    requirement: BLDR-07
    verification:
      - kind: manual_procedural
        ref: "Plan 02-17 actual attempt"
        status: fail
    human_judgment: true
    rationale: "The actual attempt ended during setup apply before activation or Codex process start, so the UAT goal was not reached."
  - id: D3
    description: "Public records preserve the exact bounded failure and every non-certification boundary without private execution material."
    verification:
      - kind: integration
        ref: "npm run check"
        status: pass
    human_judgment: false

duration: 38min
completed: 2026-07-20
status: complete
---

# Phase 02 Plan 17: Standalone Verifier and Final Packed Codex UAT Summary

**Verifier-inclusive packed releases and exact candidate admission passed every mechanism gate, while the one actual attempt ended fail-closed at setup rollback before activation or Codex start.**

## Performance

- **Duration:** 38 min
- **Started:** 2026-07-20T14:53:18Z
- **Completed:** 2026-07-20T15:31:12Z
- **Tasks:** 4 outcomes recorded: Task 1 complete, Task 2 terminal failure, Task 3 not entered, Task 4 complete
- **Files created/modified:** 16 repository files plus one ignored private attempt root

## Accomplishments

- Added a verifier-inclusive release builder that produces distinct semantic baseline/successor tarballs through the production inventory, manifest, static-closure, fresh-extraction, syntax, and bounded identity gates.
- Added a packed successor verifier whose `preview` is read-only and whose exact `decide approve|reject` path rechecks package, release, tarball, executing bytes, unique journal, candidate-ready, evidence basis, scenario count, and all false certification flags.
- Proved the named baseline/other/wrong-tarball/same-version/tampered/stale/basis/flag/double-decision cases fail closed without journal or candidate mutation.
- Created one actual verifier-inclusive attempt only after all pre-attempt gates passed; recorded its first setup rollback failure as one immutable terminal and independently verified that Task 4 appended nothing.
- Updated README and the 2026-07-20 release record with exact bounded identities and the explicit non-success/non-certification boundary.

## Task Outcomes and Commits

No commits were created. The parent execution contract explicitly prohibited staging, committing, pushing, or changing shared planning state.

1. **Task 1: Implement and fixture-test release builder plus successor verifier** — complete; commits: none.
2. **Task 2: Build actual releases and reach activation-applied** — actual releases passed identity gates, but the sole setup apply failed closed before `setup-applied`; the unique journal was terminated; commits: none.
3. **Task 3: Observe lifecycle and preview candidate** — not entered because the valid pre-candidate failure branch prohibited Codex start and further journal progression; commits: none.
4. **Task 4: Verify terminal and maintain bounded public evidence** — complete; the terminal was independently verified read-only and docs were updated; commits: none.

## Actual Bounded Outcome

The release builder produced:

| Release | Version | Release digest | Tarball digest |
| --- | --- | --- | --- |
| Baseline | `0.1.0-uat.17.1` | `sha256:04f700671552a27cd24561f433ff0bc12e527a0ec6fef3e026033c78e4337105` | `sha256:ab2c27521575d57ac11e32d27f5071114f65d30c6e9f892d685b1c1b27345563` |
| Successor | `0.1.0-uat.17.2` | `sha256:43fe7a96619f83563e48e34b82edb45b10327f4b575b029aca441d6ce0ecee97` | `sha256:dd6aeabdf92c9af1fba3f5ae7e22486b4854295b26ed42f722a75723661150be` |

Both fresh extractions bound the official verifier bytes to `sha256:e73b9c195363c521d423f0702d2dc7d0be66933b26d6494b834bc821dd4662f2`.

The baseline setup preview and its single apply used the same plan digest `sha256:48388698a454f21e5e77aa2058fb47c7386c80f00fba9bf6764ef279374642c7`. Apply failed with `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED`. The unique two-entry journal ends in the matching `failure` terminal at head `sha256:5a82e22d54bb8a52f1515d54e03d0e0668efdc083637b426d5280b38ebeb8d5f`.

Independent Task 4 verification loaded the complete unique chain through the packed release, matched terminal kind/code/head, captured the complete journal file set before and after, and confirmed no append. No `setup-applied`, `activation-applied`, Codex process, trust/auth observation, SessionStart, scenario, candidate, verifier preview, human decision, or live success exists.

## Files Created/Modified

- `scripts/build-builder-uat-releases.js` — Distinct actual/synthetic UAT release producer with closed package and publication gates.
- `scripts/verify-codex-uat-candidate.js` — Fresh-extraction-only candidate preview and exact decision CLI.
- `src/builder-codex-uat.js` — Closed verifier admission and one-shot decision authority.
- `src/builder-codex-uat-continuation.js` — Unique official verifier path admission for the packed continuation manifest.
- `src/builder-package.js`, `package.json` — Verifier-inclusive release inventory, closure, files, and syntax checks.
- `test/builder-codex-uat.test.js`, `test/builder-packed-install.test.js` — Release/verifier positive and hostile matrices plus official continuation-path checks.
- `test/artifact-surface-coverage.test.js`, `test/helpers/io-surface-inventory.js` — Exact Plan 17 artifact and I/O ownership.
- `test/builder-package-security.test.js`, `test/builder-lifecycle.test.js`, `test/builder-codex-host.test.js` — Existing temporary package helpers now copy only the exact packed verifier asset.
- `README.md`, `release/2026.07.20.md` — Value-blind mechanism, exact failure outcome, and remaining-risk records.

## Decisions Made

- Kept one canonical package name and required distinct semantic versions, release digests, and tarball digests instead of weakening the UAT release identity.
- Made the manifest verifier path an exact constant rather than a permissive `src/*.js` pattern or dual-path compatibility surface.
- Did not run standalone verifier preview or decision because candidate-ready was never reached.
- Did not retry setup, launch Codex, create a second attempt, or append a human decision after the first terminal.
- Treated `status: complete` as plan-execution/evidence-recording completion only; Phase 2 remains incomplete and `gaps_found`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Normalized Darwin system aliases in release publication checks**
- **Found during:** Task 1 release-builder fixture verification.
- **Issue:** `/var` and `/tmp` may resolve through `/private/...` on macOS, rejecting an otherwise exact temporary release output.
- **Fix:** Applied the repository's existing bounded Darwin alias rule while retaining symlink and containment checks.
- **Files modified:** `scripts/build-builder-uat-releases.js`.
- **Verification:** Focused release-builder tests and full repository gate pass.
- **Committed in:** None by explicit instruction.

**2. [Rule 3 - Blocking] Closed existing temporary package helpers over the new verifier asset**
- **Found during:** Task 1 full repository verification.
- **Issue:** Three pre-existing shared package fixtures copied `bin`, `plugin`, and `src` but omitted the newly required portable verifier, causing package admission to fail before their intended assertions.
- **Fix:** Each helper now creates `scripts/` and copies only `scripts/verify-codex-uat-candidate.js`; no assertion was removed or weakened.
- **Files modified:** `test/builder-package-security.test.js`, `test/builder-lifecycle.test.js`, `test/builder-codex-host.test.js`.
- **Verification:** Affected suites 85/85 and full repository 658/658 pass.
- **Committed in:** None by explicit instruction.

**3. [Rule 3 - Blocking] Aligned the packed continuation with the official verifier path**
- **Found during:** Task 1 pre-Task-2 continuation audit.
- **Issue:** The prior continuation manifest parser still required the removed `src/builder-codex-uat-verifier.js` path, so an actual Plan 17 release would fail before uninstall.
- **Fix:** Required only `scripts/verify-codex-uat-candidate.js`, updated the synthetic packed manifest, rejected legacy/other/nested/prefix variants, and synchronized exact I/O rows. Continuation still never executes verifier.
- **Files modified:** `src/builder-codex-uat-continuation.js`, `test/builder-packed-install.test.js`, `test/helpers/io-surface-inventory.js`.
- **Verification:** Continuation focused 1/1, packed 15/15, Task 1 focused 25/25, and artifact-surface 14/14 pass.
- **Committed in:** None by explicit instruction.

**4. [Rule 1 - Bug] Replaced the old src-only identity regex with exact per-asset paths**
- **Found during:** Task 1 continuation focused verification.
- **Issue:** A shared identity validator rejected the new official `scripts/` verifier path before the exact manifest check.
- **Fix:** The validator now requires the caller's exact continuation or verifier path, preserving a closed one-path contract.
- **Files modified:** `src/builder-codex-uat-continuation.js`.
- **Verification:** Old, other, nested, and prefix paths reject; exact continuation and full gates pass.
- **Committed in:** None by explicit instruction.

---

**Total deviations:** 4 auto-fixed: 2 Rule 1 bugs and 2 Rule 3 blocking integration gaps.

**Impact on plan:** All changes were necessary to make the planned packed verifier and continuation exact and runnable. No second UAT attempt, extra runtime feature, or broader certification surface was added.

## Issues Encountered

- The single actual setup apply failed closed at the host rollback boundary. Read-only doctor evidence remained bounded and showed an inconsistent partial project projection with no receipt or verified activation. This issue was not repaired or retried; it became the unique terminal outcome.
- The first Task 4 read-only audit assumed the journal path was a directory and received `ENOTDIR`. No mutation occurred. The corrected audit captured the base file plus immutable successor entry and proved the complete set unchanged.

## Authentication Gates

None. The attempt failed before Codex process launch and before any normal trust/authentication gate.

## Known Stubs

None. The scan found only bounded accumulators, optional-state nulls, and test capture variables; no TODO, FIXME, placeholder, or goal-blocking unwired runtime surface was introduced. The missing actual lifecycle evidence is an explicit failed outcome, not a stub.

## Verification

- Task 1 affected suites — 85/85 pass.
- Continuation focused — 1/1 pass.
- Packed suite — 15/15 pass.
- Task 1 core plus packed focused — 25/25 pass.
- Phase 02-11 through 02-17 focused Builder gate — 206/206 pass before actual attempt creation.
- Final `node --test test/builder-codex-uat.test.js test/builder-packed-install.test.js test/artifact-surface-coverage.test.js` — 39/39 pass.
- Final `npm run check` — 658/658 pass across 70 suites; 0 failed, skipped, or todo.
- Final `git diff --check` — pass.
- Unique terminal verification — exact two-entry failure chain, matching code/head, complete journal file set unchanged, appended false.

## Certification Boundary

The following remain false or unproven: cryptographic Codex origin, real Codex session behavior, activation, host behavior, domain quality, Agent Package quality, package certification, production readiness, deployment approval, and wider Codex/OpenClaw compatibility. The exact release and mechanism tests do not promote these claims.

## User Setup Required

None for this completed failure record. Before any future attempt, a human must explicitly review the partial projection and authorize both remediation and a new isolated attempt; this plan does not perform either action.

## Next Phase Readiness

Plan 02-17 execution is complete because the valid failure branch and public record are closed. Phase 2 and the UAT goal are not complete. The next work must diagnose the host rollback failure and partial projection ownership without mutating the retained evidence, then replan any newly authorized attempt. The existing journal cannot resume into Task 3.

## Self-Check: PASSED

- Release builder, standalone verifier, release record, and this summary exist.
- README, release record, and summary contain the exact bounded terminal code/head and no actual private attempt path.
- Tracked and newly created documentation passes whitespace checks.
- The complete unique journal was independently reloaded and remained byte-for-byte unchanged.
- Commit lookup is not applicable: the execution contract required commits to remain `none`.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-20*
