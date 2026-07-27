---
phase: 02-codex-builder
plan: "07"
subsystem: codex-builder-lifecycle
tags: [runtime-inventory, hostile-filesystem, consumer-ledger, selector-owner, durable-reservation]
requires:
  - phase: 02-codex-builder
    plan: "06"
    provides: [activated v3 receipt, fixed official Codex host adapter, selector owner and consumer ledger]
provides:
  - canonical-inventory lifecycle parity for every packed runtime byte
  - sibling-safe exact consumer removal with last-reference owner handoff
  - separately authorized zero-reference selector removal through the fixed official interface
  - durable cross-transaction reservation for shared selector evidence
affects: [02-08-recovery, 02-09-behavior-evidence, 02-10-clean-host-uat, codex-builder-release]
tech-stack:
  added: []
  patterns: [canonical inventory derivation, digest-plus-inode CAS, receipt-last shared-state lifecycle, durable opaque reservation]
key-files:
  created:
    - .planning/phases/02-codex-builder/02-07-SUMMARY.md
  modified:
    - src/builder-lifecycle.js
    - src/builder-codex-host.js
    - src/builder-install.js
    - src/cli.js
    - test/builder-lifecycle.test.js
    - test/builder-codex-host.test.js
    - test/builder-cli.test.js
    - test/builder-install-security.test.js
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js
    - README.md
    - release/2026.07.16.md
key-decisions:
  - "Project uninstall owns only its exact consumer entry; an empty ledger signals owner action but never grants project selector-deletion authority."
  - "Selector removal is a separate user-scope preview/apply operation bound to external owner and empty-ledger digests and the fixed official remove command."
  - "Owner/ledger mutation is serialized by a durable opaque reservation held across activation receipt publication, project receipt terminal or rollback, and selector removal cleanup."
  - "Successful selector cleanup retains the exact evidence pair outside canonical authority instead of attempting a non-atomic double deletion."
  - "Once a canonical activated receipt cannot be retracted exactly, its matching owner/consumer evidence is committed rather than rolled back into a split-brain state."
  - "Staged publication is authorized by the exact inode created through the retained file handle, never by pathname plus bytes alone."
  - "Receipt retraction requires a reservation/host/reservation proof of exact rollback authority; lost authority commits receipt and host evidence together."
patterns-established:
  - "Runtime lifecycle parity: derive targets from the canonical release inventory and bind digest, inode, link count, staged bytes, parent state and receipt-last postconditions."
  - "Shared-state reservation: atomic fixed-directory claim, canonical exact marker, WeakMap capability, no TTL takeover, exact-rename release into retained non-authoritative evidence."
  - "Authority split: project receipt removes one consumer; only explicit owner authority may submit fixed selector removal after observing an exact empty ledger."
requirements-completed: []
requirements-progressed: [BLDR-01, BLDR-06]
requirements-pending: [BLDR-01]
coverage:
  - id: D1
    description: "Upgrade and uninstall derive every packed runtime target from the canonical inventory and retain hostile-filesystem compare, quarantine, no-clobber and receipt-last controls."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-lifecycle.test.js#receipt-owned Builder lifecycle"
        status: pass
    human_judgment: false
  - id: D2
    description: "Project lifecycle exact-CAS removes only its own consumer, preserves siblings, blocks shared release replacement and leaves the last selector for owner action."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#preview-bound Codex host activation"
        status: pass
    human_judgment: false
  - id: D3
    description: "Explicit zero-reference owner removal requires external owner/ledger admission, durable reservation, fixed official removal, observed absence and exact evidence cleanup."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#explicit zero-reference selector owner removal"
        status: pass
      - kind: integration
        ref: "test/builder-cli.test.js#builder CLI selector owner authority"
        status: pass
    human_judgment: true
    rationale: "The automated suite proves the bounded mechanism and concurrency contract; authenticated normal-trust clean-host Codex UAT remains required before BLDR-01 can close."
duration: multi-pass implementation and independent transaction-review remediation
completed: 2026-07-16
status: complete
---

# Phase 2 Plan 07: Codex Builder Lifecycle Summary

**Packed runtime lifecycle now covers the complete canonical inventory, removes only exact project references, and reserves shared owner state across independently authorized selector removal.**

## Performance

- **Duration:** Multi-pass TDD plus independent transaction-review remediation and full verification
- **Started:** 2026-07-16T09:54:39Z
- **Completed:** 2026-07-16T12:08:47Z
- **Tasks:** 3
- **Files modified:** 12 implementation, test, surface-contract and documentation files

## Accomplishments

- Extended upgrade/uninstall from plugin assets to the exact canonical packed runtime inventory while preserving digest/inode admission, hardlink/symlink refusal, staged-byte revalidation, no-clobber publication, retained quarantine and receipt-last terminal checks.
- Added activated v3 receipt admission and exact host-binding cross-validation; same-release upgrades preserve v3 evidence while release-changing upgrades stop before shared selector mutation.
- Made project uninstall remove only its deterministic consumer through digest-and-inode CAS. Siblings remain intact; the final consumer leaves the selector and owner in place and reports `host-owner-action-required`.
- Added an independent `--host-scope user --remove-host-selector` preview/apply route requiring one owner digest, one empty-ledger digest and the exact plan digest. Arbitrary selector, argv, path and mixed receipt authority are rejected.
- Added a durable user-state reservation shared by every owner/ledger writer. Activation holds it through receipt publication, project lifecycle through receipt terminal or rollback, and selector removal through fixed official removal and exact evidence cleanup.
- Retained successful owner/ledger cleanup as one exact non-authoritative pair, avoiding partial evidence deletion when a second filesystem cleanup step fails.
- Bound each staged runtime or receipt candidate to the exact inode created through AgentMo's retained handle, revalidated it immediately before publication, and preserved same-byte replacement inodes as foreign state.
- Moved lifecycle's irreversible host commit point ahead of retained-prior disposal and kept matching host evidence when a canonical activated receipt could no longer be retracted exactly.
- Made lifecycle stage cleanup exact-identity-only and made activated receipt retraction conditional on still-provable host rollback authority, preserving coherent receipt/owner/ledger state under reservation contamination.

## TDD Evidence

- **Task 1 RED:** runtime mutation-seam additions initially passed 23/26; staged tamper, upgrade receipt race and uninstall receipt recreation failed as intended. A same-byte staged inode case also failed before identity binding.
- **Task 1 GREEN:** `node --test test/builder-lifecycle.test.js` passes 27/27.
- **Task 2 RED:** identity-bound consumer CAS, sibling/last-reference removal and same-release activated upgrade began at 0/3; release replacement and post-CAS race cases then exposed the remaining gaps.
- **Task 2 GREEN:** project A/B reference removal, last-owner handoff, v3 preservation, release blockers and rollback cases pass in the host suite.
- **Task 3 RED:** the explicit owner-removal exports were absent, and accepted CLI syntax could not route to external owner evidence admission.
- **Task 3 GREEN:** owner-removal API cases and CLI authorization cases pass, including preexisting/nonempty evidence, official failure and post-observation mismatch.
- **Review RED/GREEN:** independent review reproduced non-atomic pair deletion, empty-ledger insertion at the official-command seam, digest-only same-byte recovery, exact-prior inode loss and post-finalize ghost-consumer rollback. Dedicated regressions failed first, then passed after retained-pair cleanup, durable reservation, exact-prior recovery and an explicit irreversible commit point were added.
- **Final re-review RED/GREEN:** three dedicated regressions first reproduced (1) a ghost consumer after partial quarantine finalization, (2) activated-receipt/host split brain when receipt quarantine could not start, and (3) adoption of a same-byte new-inode stage. They pass after pre-cleanup host commit, irreversible-receipt host commit, and exact staged-inode publication/cleanup were added.
- **Bounded final-quality RED/GREEN:** the lifecycle regression first failed because finally deleted a rejected same-byte competitor stage; the host regression first failed because contaminated reservation state allowed receipt retraction before rollback failed. Both pass after exact stage cleanup and pre-retraction rollback-authority proof.

## Review and Verification

- Latest bounded direct regressions — **2/2 pass** across two commands (competitor stage preservation and receipt/host consistency under reservation contamination).
- Earlier final-review direct regressions — **3/3 pass** across two commands.
- Focused lifecycle/host/CLI gate — **68/68 pass** across seven suites.
- Extended package/install/packed/doctor/runtime/surface gate — **61/61 pass** across six suites.
- Host concurrency and owner-authority suite — **36/36 pass** across four suites.
- `node --test test/artifact-surface-coverage.test.js` — **10/10 pass**.
- `npm run check` — **591/591 pass** across 64 suites.
- `npm pack --dry-run --json --cache /tmp/agentmo-npm-cache-02-07-final` — pass, 59 allowlisted entries.
- `git diff --check` — pass.
- Parent-task final independent verification — **CLEAN**; the latest 2/2 direct regressions and 68/68 focused gate pass with no remaining P1/P2.

## Decisions Made

- Kept project and owner authority separate. Project receipt admission can remove one exact consumer but cannot invoke the selector remove command, even when it creates an empty ledger.
- Preserved an activated receipt v3 on a same-release upgrade instead of downgrading it to projected v2 evidence.
- Treated current ledger advancement by a legitimate sibling as valid shared state during planning, while binding every mutation to the current exact ledger inode and digest.
- Replaced permissive concurrent writer advancement during an active receipt transaction with fail-closed serialization. A sibling operation retries from a fresh plan after the reservation releases rather than advancing state that the first transaction may roll back.
- Kept completed and failed reservation evidence under private, non-authoritative names. A stale active reservation is never stolen by timestamp, PID or caller assertion.

## Deviations from Plan

### Auto-fixed Issues

1. The exact I/O surface inventory shifted as lifecycle and host calls moved. Plan 02-07 ownership rows and all current line identities were synchronized without broadening the allowlist.
2. File identity initially included change time, which changes on safe rename. The opaque identity binding was narrowed to stable device, inode, link count and size while stable reads continue to compare timestamps during capture.
3. Review found successful owner cleanup could delete the only retained owner before a later ledger deletion failure. Success now retains the exact pair outside canonical authority and never performs the unsafe double unlink.
4. Review found a sibling could CAS-add a consumer after the empty-ledger check but before official removal. A durable opaque reservation now serializes all state writers and spans each high-level receipt/owner transaction.
5. Review found failed cleanup accepted same-byte retained evidence on a new inode. Recovery now requires the original digest and identity before linking and verifies the restored canonical identity.
6. Closing the reservation race required `src/builder-install.js` to participate across official activation, owner/ledger publication, receipt publication and rollback. This was a necessary shared-state safety integration outside the plan's initial file list, with no new product scope or dependency.
7. Review found update rollback recreated valid prior JSON on a new inode after the forward writer deleted its retained prior. Long reservations now retain the exact prior inode, restore it no-clobber on abort, and move it into the retired reservation archive on commit; same-byte competitors are preserved.
8. Review found lifecycle could finalize its project quarantine and then roll the consumer ledger back after a later observation failure, creating a ghost reference with no receipt. Finalization is now the irreversible commit point; later failures retire the reservation as committed and never restore host state.
9. Final review found retained-prior cleanup could unlink one record and then fail on an unknown quarantine entry before the old commit flag was set. Terminal project/receipt and transaction-record validation now commit host state before cleanup starts, so partial disposal cannot restore a ghost consumer.
10. Final review found an already-published activated receipt could remain canonical when its retraction quarantine could not start while outer compensation still rolled owner/ledger evidence back. That exact case now commits verified matching host evidence and releases the reservation as committed before returning the original terminal error.
11. Final review found same-byte pathname replacement of a runtime stage could be adopted because staging authority was digest-only. Stage creation now retains the exact device/inode/link/size identity, checks it immediately before linking, verifies both hardlinks against that inode, and cleans up only that exact stage; a competitor is preserved.
12. Final quality review found lifecycle's unconditional stage-path cleanup deleted a same-byte competitor after correctly rejecting its new inode. Cleanup now re-reads the exact digest, identity and single-link state and removes only AgentMo's created inode; mismatches remain untouched.
13. Final quality review found a reservation contaminated after activated receipt publication could allow canonical receipt retraction before exact host rollback failed. Receipt retraction now requires a reservation/host/reservation proof; if it fails, receipt and exact host evidence remain committed, and failed retirement preserves the active blocking reservation.

**Total deviations:** 13 correctness, review and repository-contract fixes. All preserve the plan's authority and hostile-filesystem boundaries.

## Evidence Boundary

This plan proves bounded runtime lifecycle, shared-reference accounting, reservation and official-call mechanics. It does not certify Agent Package quality, domain behavior, production readiness or deployment approval. BLDR-01 remains pending until authenticated normal-trust clean-host Codex UAT. A stale active reservation intentionally blocks further host-state mutation until an explicit evidence-aware recovery workflow is delivered; it is not self-healed or time-stolen.

## Commits

None — the user did not authorize staging or commits.

## User Setup Required

None for this plan. Hook trust and authenticated clean-host UAT remain explicit human-owned steps.

## Next Phase Readiness

Plans 02-08 through 02-10 can build recovery, behavior evidence and clean-host UAT on the exact lifecycle and reservation boundaries established here. This summary does not mark Phase 2 or BLDR-01 complete.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-16*
