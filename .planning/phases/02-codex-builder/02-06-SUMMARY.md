---
phase: 02-codex-builder
plan: "06"
subsystem: codex-user-host-activation
tags: [codex-plugin, app-server, user-host-scope, selector-ownership, consumer-ledger, read-only-doctor]
requires:
  - phase: 02-codex-builder
    plan: "05"
    provides: [packed project-local runtime, receipt-last projection, external receipt anchor]
provides:
  - fixed bounded official Codex host observer and add/remove adapter
  - explicit preview-bound user-host activation with v3 receipt-last evidence
  - separate selector owner record and sorted project-consumer ledger
  - read-only projection, host, trust, ownership and agent observability diagnosis
affects: [02-07-host-lifecycle, 02-10-clean-host-uat, codex-builder-release]
tech-stack:
  added: []
  patterns: [fixed official host boundary, value-blind observation, prior-digest CAS, shared-selector reference accounting]
key-files:
  created:
    - src/builder-codex-host.js
    - test/builder-codex-host.test.js
  modified:
    - src/builder-install.js
    - src/builder-doctor.js
    - src/builder-package.js
    - src/cli.js
    - package.json
    - test/builder-packed-install.test.js
    - test/builder-doctor.test.js
    - test/helpers/io-surface-inventory.js
key-decisions:
  - "Host mutation is available only after an exact preview explicitly selects hostScope user; project-only preview remains non-mutating and reports the missing scope."
  - "The AgentMo-owned selector record and sorted consumer ledger live outside Codex-owned cache, config and trust state; each project receipt owns only its consumer reference and never selector deletion authority."
  - "Successful activation requires installed, enabled, source/release-matched, skill-visible and hooks-visible post-observation before the project receipt publishes last; hook trust remains human-owned."
  - "Doctor receives observation and stable-read capability only, reports host visibility separately from project projection, and never repairs state."
patterns-established:
  - "Official host calls: fixed selector and argv, shell false, five-second timeout, 64 KiB output ceiling, minimal environment and value-blind normalized facts."
  - "Shared selector evidence: canonical owner bytes plus a sorted consumer set, both published by exact prior-digest CAS with no direct Codex-state writes."
  - "Evidence boundary: host-observed activation proves bounded mechanism execution only; host behavior, domain quality and production readiness remain false."
requirements-completed: []
requirements-progressed: [BLDR-01, BLDR-05]
requirements-pending: [BLDR-01]
coverage:
  - id: D1
    description: "The packed runtime contains one fixed, bounded, value-blind official Codex host adapter and canonical owner/consumer evidence primitives."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-codex-host.test.js#fixed Codex user-host adapter"
        status: pass
      - kind: integration
        ref: "test/builder-packed-install.test.js#deterministic fixed runtime inventory and packed import closure"
        status: pass
    human_judgment: false
  - id: D2
    description: "An explicitly approved user-scope packed setup executes the official add boundary, re-observes activation, and publishes a non-deleting project receipt last."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#packed CLI user-host preview and apply"
        status: pass
      - kind: integration
        ref: "test/builder-codex-host.test.js#stale ledger, official failure and post-observation failure"
        status: pass
    human_judgment: true
    rationale: "The packed CLI exercises the real AgentMo route against a contract-faithful local Codex executable; authenticated clean-host Codex UAT remains required before BLDR-01 can close."
  - id: D3
    description: "Doctor reports projection, activation, enablement, skill/hooks visibility, trust, owner, consumer and agent observability as distinct read-only facts."
    requirement: BLDR-05
    verification:
      - kind: integration
        ref: "test/builder-doctor.test.js#activated, corrupt-owner and host-disagreement snapshots"
        status: pass
    human_judgment: false
duration: multi-pass implementation and independent review remediation
completed: 2026-07-16
status: complete
---

# Phase 2 Plan 06: Codex User-host Activation Summary

**Packed setup can now activate the fixed AgentMo selector through official Codex interfaces while preserving shared-selector ownership, receipt-last evidence and read-only diagnosis.**

## Performance

- **Duration:** Multi-pass implementation plus three independent review/remediation loops
- **Started:** 2026-07-16T02:28:24Z
- **Completed:** 2026-07-16T09:50:54Z
- **Tasks:** 3
- **Files modified:** 12 implementation, test and surface-contract files

## Accomplishments

- Added a packed Codex host module with fixed official plugin/App Server calls, bounded execution, minimal environment propagation and value-blind observations.
- Bound explicit `--host-scope user` preview/apply to selector operation, release/source identity, owner disposition, prior/desired owner and ledger digests, and post-observation requirements.
- Published canonical owner and sorted consumer evidence outside Codex-owned state, revalidated project/user evidence before add, and kept the activated v3 project receipt last.
- Made owner/consumer authority transactional with the receipt: official/post-observation failures publish nothing, and later receipt failure retracts only exact AgentMo state through digest-bound compensation.
- Closed host races and fail-open observations with an immediate pre-mutation observation check, exact project-local source closure, no-clobber CAS competition handling, canonical state roots and explicit enabled/available facts.
- Sequenced the real Codex App Server protocol as initialize-response first and only then the fixed query set, kept stdin open until all three exact results arrived, and retained strict response-id and error validation.
- Added an externally anchored exact v2-to-v3 activation path: the v2 receipt is replaced last, inode-bound preview drift and same-byte inode replacement after immediate host observation fail before mutation, and terminal failure restores the exact v2 bytes.
- Made rollback dependency-aware: when a sibling advances the shared consumer ledger, failed ledger compensation preserves the selector owner instead of deleting state the sibling still depends on.
- Preserved honest trust semantics: installed/enabled/skill/hooks visibility can be observed while hook trust remains `pending-human`; behavior, domain and production claims stay false.
- Extended Doctor with separate projection, host, ownership and agent states, including `missing-projection`, `pristine-projection`, `host-visible` and `projected-but-host-unobservable`; activation certification now also requires a pristine current projection.

## Review and Verification

- Independent final review — **CLEAN**, with all six reproduced P1 findings closed and no remaining P1/P2.
- Isolated writable HOME/CODEX_HOME observation against Codex CLI 0.144.2 returned exact App Server results 1/2/3/4 with no duplicate or RPC error.
- Focused host/packed/doctor gate — **41/41 pass** across five suites.
- Extended host/packed/doctor/package/install security gate — **59/59 pass** across seven suites.
- Host plus artifact-surface recheck after final review hardening — **27/27 pass**.
- `node --test test/artifact-surface-coverage.test.js` — **10/10 pass**.
- `npm run check` — **561/561 pass** across 62 suites.
- `npm pack --dry-run --json --cache /tmp/agentmo-npm-cache-02-06-p1-final` — pass, 59 packed entries including `src/builder-codex-host.js`.
- `git diff --check` — pass.

## Decisions Made

- Kept the existing project-only projection path compatible. Omitted host scope never mutates the user host and now reports `explicit-user-host-scope-required`; a supplied scope accepts only `user`.
- Introduced an activated receipt v3 while retaining projected receipt v2. Destructive host lifecycle authority is intentionally deferred to Plan 02-07.
- Treated a legitimately expanded shared consumer ledger as reference advancement rather than granting older project receipts ownership of the selector.
- Kept official hook trust separate from activation success; setup and Doctor report `pending-human` without writing trust state.
- Kept receipt failure compensation authority-bounded: it restores a prior exact digest or retracts an exact newly-created record, never removes the shared Codex selector and never overwrites a competing path.

## Deviations from Plan

### Auto-fixed Issues

1. The repository-wide I/O surface ledger required new Plan 02-06 ownership rows and shifted line identities after the host module and Doctor changes. The exact allowlist and owner regex were updated and the surface gate passes.
2. The OpenClaw runtime seam test intentionally inventoried every JavaScript `spawn` site. It was extended to acknowledge the separate fixed Codex App Server spawn without weakening the existing OpenClaw barrier assertions.
3. The default user npm cache was not writable. Tarball verification was rerun with the isolated `/tmp/agentmo-npm-cache-02-06` cache and passed.
4. Final review found authority publication could outlive a failed receipt, the preview observation could drift immediately before mutation, and a suffix-only source match could admit another project. Setup now re-observes before mutation, uses exact project-local source closure, and compensates owner/ledger state on every later failure; focused failure tests prove no receipt or deletion authority remains.
5. Final review also found CAS recovery could overwrite a concurrent writer, ancestor symlinks could reach the AgentMo state root, and missing enablement/failed observation fields were too permissive. Publication now preserves competitor bytes, state roots require canonical directories, and host/Doctor facts fail closed as unavailable. Dedicated race, symlink, disabled-hook and unavailable-observation tests pass.
6. Protocol and upgrade review found that App Server queries were sent before the initialize response and that an exact externally anchored v2 receipt could not transition to v3. The host now completes a strict initialize handshake before queries; setup now replaces an approved exact v2 receipt last, rejects inode drift and restores exact v2 bytes after terminal failure. Real child-process, packed CLI, tamper and rollback regressions pass.
7. Concurrency and diagnostic review found that failed ledger compensation could still delete the shared owner, and Doctor could certify activation from a moved, scope-mismatched projection. Rollback now fail-stops before owner removal when the ledger has advanced, and Doctor requires a pristine projection before activation certification. Dedicated sibling-advance and moved-project regressions pass.
8. Final P1 review found that closing App Server stdin immediately after sending the fixed queries caused Codex CLI 0.144.2 to stop after initialize, and that the immediate observation seam could replace an approved v2 receipt with the same bytes on a new inode before the official add. The adapter now holds stdin open until exact results 2/3/4 arrive, while setup revalidates fresh-absent, exact v2 and repeat-v3 receipt state after observation and before any host mutation. Contract-faithful EOF and same-byte inode-swap regressions pass.

**Total deviations:** 8 auto-fixed review and maintenance issues. All were required to preserve the plan's security and repository-wide verification contracts; no product scope was added.

## Evidence Boundary

This plan proves fixed official-call mechanics, explicit user-host approval, owner/reference accounting, receipt-last activation evidence and read-only normalized diagnosis. It does not certify Agent Package quality, domain behavior, production readiness or deployment approval. BLDR-01 remains pending until authenticated clean-host Codex UAT closes the real-host installation boundary.

## Commits

None — the user did not authorize staging or commits.

## User Setup Required

None for this plan. Hook trust remains an explicit human-owned Codex decision and is not modified by AgentMo.

## Next Phase Readiness

Plan 02-06 implementation and local verification are complete and await the parent task's independent re-review; this summary does not claim a clean review. Plan 02-07 can add receipt/reference-aware uninstall rules without granting any project selector deletion authority; later clean-host UAT must still close BLDR-01.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-16*
