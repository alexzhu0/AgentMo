---
phase: 02-codex-builder
plan: "20"
subsystem: project-install-transaction-recovery
tags: [codex, filesystem, recovery, retained-handles, receipt-last, hostile-races]

requires:
  - phase: 02-codex-builder
    plan: "19"
    provides: Retained shared-host authority and conflict-preserving host-state compensation
provides:
  - Receipt-last project installation with a durable value-blind recovery authority before canonical managed publication
  - Restart-safe inspect, exact preview, and digest-bound apply recovery operations
  - Open-stage inode authority through publication and conflict-preserving final-window race handling
  - Packed recovery closure without checkout imports and an exact Plan 02-23 I/O/import handoff
affects: [codex-builder, project-install, packed-install, lifecycle, plan-02-23-inventory]

tech-stack:
  added: []
  patterns:
    - Keep staged and retained-prior file handles open through their final filesystem effects
    - Publish canonical managed files only after durable recovery authority exists
    - Bind recovery preview and apply to exact root, authority inode, bytes, and observed project state

key-files:
  created:
    - .planning/phases/02-codex-builder/02-20-SUMMARY.md
  modified:
    - src/builder-install.js
    - src/cli.js
    - test/builder-install-security.test.js
    - test/builder-cli.test.js
    - test/builder-packed-install.test.js
    - test/builder-lifecycle.test.js

key-decisions:
  - "A receiptless partial projection is recoverable only through the exact durable recovery authority; legacy partial state without it remains read-only."
  - "Recovery apply requires the exact preview digest and revalidates authority inode, canonical bytes, root identity, and current state immediately before effects."
  - "A stage pathname is never publication authority after its handle closes; the retained stage inode remains open through link and post-link verification."
  - "Keep canonical artifact and I/O inventory reconciliation in Plan 02-23 as required."

patterns-established:
  - "Receipt-last transaction: durable recovery authority -> managed projection -> host mutation -> receipt publication -> recovery retirement."
  - "Ambiguous final-window entries are retained as conflict evidence and never adopted, overwritten, or deleted as operation-owned state."

requirements-completed: [BLDR-01, BLDR-05, BLDR-06]

coverage:
  - id: CR-03
    description: "Interrupted project setup either restores exact pre-state or leaves a loadable, restart-safe recovery transaction."
    requirement: BLDR-05
    verification:
      - kind: integration
        ref: "test/builder-install-security.test.js#interrupted rollback leaves exact loadable recovery and exact apply restores pre-state"
        status: pass
      - kind: integration
        ref: "test/builder-packed-install.test.js#packed failed install supports fresh-process inspect preview apply without checkout paths"
        status: pass
    human_judgment: false
  - id: CR-04
    description: "Final-window stage replacement cannot reach a canonical managed destination and foreign bytes remain preserved."
    requirement: BLDR-05
    verification:
      - kind: integration
        ref: "test/builder-install-security.test.js#final-window stage replacement is preserved and never published canonically"
        status: pass
    human_judgment: false
  - id: RECOVERY
    description: "Recovery rejects missing, corrupt, stale, symlinked, unsafe-ancestor, wrong-root, wrong-inode, and extra-field authority without writes."
    requirement: BLDR-06
    verification:
      - kind: integration
        ref: "test/builder-install-security.test.js#recovery authority hostile cases"
        status: pass
      - kind: integration
        ref: "test/builder-cli.test.js#builder recover closed CLI routes"
        status: pass
    human_judgment: false
  - id: PACKED
    description: "Packed recovery is complete-or-reject and lifecycle previews preserve outstanding receiptless recovery state."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#packed recovery closure"
        status: pass
      - kind: integration
        ref: "test/builder-lifecycle.test.js#upgrade and uninstall previews preserve recovery transaction bytes and inodes"
        status: pass
    human_judgment: false

duration: 2h
completed: 2026-07-21
status: complete
---

# Phase 02 Plan 20: Receipt-Last Project Transaction and Recovery Summary

**Project installation now publishes durable, value-blind recovery authority before canonical managed bytes, retains exact stage/prior inodes through final effects, and supports restart-safe inspect/preview/apply recovery from packed code.**

## Performance

- **Duration:** approximately 2h
- **Completed:** 2026-07-21
- **Tasks:** 3/3 complete
- **Files changed by this plan:** 6 implementation/test files plus this summary
- **Commits:** none — prohibited by the execution contract
- **Planning state:** intentionally unchanged

## Accomplishments

- Closed CR-03 by treating managed project files, retained prior state, host mutation, and receipt-last publication as one recoverable transaction. Every injected boundary now proves exact restoration or a loadable recovery record.
- Closed CR-04 by retaining each stage `FileHandle` through link and post-link identity verification. A replacement injected after the last ordinary check is preserved and cannot become canonical.
- Added exported recovery schema/path constants and closed `inspectBuilderInstallRecovery`, `planBuilderInstallRecovery`, and `applyBuilderInstallRecovery` operations. Apply requires the exact preview digest and rejects changed authority or project state.
- Added `agentmo builder recover inspect|preview|apply`; read-only routes accept no apply aliases, while apply requires `--plan-digest sha256:<64hex>`.
- Proved fresh packed-process recovery without repository imports and lifecycle preview preservation of an outstanding receiptless transaction.

## Task Outcomes and Commits

No commits were created. The execution contract prohibited staging, committing, pushing, tagging, stashing, and branch switching.

1. **Task 1: Reproduce partial projection and staging replacement** — complete. RED tests reproduced absent partial-prestate authority and closed-stage final-window publication gaps; commits: none.
2. **Task 2: Implement receipt-last project transaction and explicit recovery** — complete. Exact recovery authority, retained-stage publication, preview-bound apply, and the closed CLI route pass hostile tests; commits: none.
3. **Task 3: Prove packed recovery closure** — complete. A fresh packed CLI process inspects, previews, and applies exact recovery without checkout paths; commits: none.

## Recovery Authority and Transaction Semantics

- Fixed authority path: `.agentmo/builder/install-recovery.json`; exported schema: `agentmo.builder-install-recovery.v1`.
- The recovery record is canonical, strict-key, value-blind JSON. It binds transaction id, canonical project root identity, intended plan/projection/receipt digests, host binding, each desired digest and retained stage inode, and exact prior state for replacement paths.
- Replace paths receive a deterministic retained-prior location before canonical publication. Recovery restores that exact original inode; it does not reconstruct historical bytes or accept a historical trust marker.
- Setup retains every staged file handle through final publication. The `before-stage-publication` seam runs after ordinary validation, then publication rechecks handle/path identity, links absent-only, and verifies the destination inode.
- If destination identity becomes ambiguous after link, the entry is renamed to private conflict-retained evidence. Foreign bytes are not deleted or granted canonical authority.
- Setup success publishes the install receipt last and then retires the recovery authority. A rejected setup restores exact pre-state when unambiguous; otherwise it returns `AGENTMO_BUILDER_INSTALL_RECOVERY_REQUIRED` with the record still loadable.
- `inspect` is strictly read-only. `preview` derives operations and a digest from exact authority/root/current-state observations. `apply` accepts only that digest, reloads and rechecks all authority, performs only exact retire/restore operations, and retires the authority after terminal verification.
- A legacy receiptless projection with no recovery record has no repair authority. Inspection diagnoses `authority-missing`; preview/apply reject and all bytes/inodes remain unchanged.
- Missing, corrupt, non-canonical, extra-field, symlinked, unsafe-ancestor, wrong-root, wrong-inode, stale-authority, or changed-project state fails closed without mutation.

## Exact I/O and Import Delta for Plan 02-23

Plan 02-23 must reconcile the canonical inventory once. This plan intentionally did not modify `test/helpers/io-surface-inventory.js` or `test/artifact-surface-coverage.test.js`.

### Producer, loader, and CLI consumer edges

- `src/builder-install.js` exports `BUILDER_INSTALL_RECOVERY_PATH`, `BUILDER_INSTALL_RECOVERY_SCHEMA_VERSION`, `inspectBuilderInstallRecovery`, `planBuilderInstallRecovery`, and `applyBuilderInstallRecovery`.
- `createBuilderInstallRecoveryAuthority` is the sole recovery-schema producer. It durably writes and synchronizes canonical authority before managed publication.
- `loadBuilderInstallRecoveryAuthority` is the strict no-follow loader. It validates the authority inode/path identity, canonical bytes, exact schema keys, project root binding, and every retained path/identity field.
- `inspectBuilderInstallRecovery`, `planBuilderInstallRecovery`, and `applyBuilderInstallRecovery` are the public consumers. `prepareInstall` is also a loader consumer so a new setup cannot bypass an outstanding transaction.
- `src/cli.js` adds imports for `applyBuilderInstallRecovery`, `inspectBuilderInstallRecovery`, and `planBuilderInstallRecovery` from `./builder-install.js`. The existing `applyBuilderInstall` and `planBuilderInstall` imports remain.
- The CLI adds the unique `builder recover` action with `inspect`, `preview`, and `apply` branches. It adds no new raw filesystem, process-execution, network, authentication, or secret-read call.
- No new production module, dependency, package asset, artifact family, or schema inventory file was added.

### New `src/builder-install.js` static I/O rows

The repository scanner reports 115 current rows versus 85 canonical rows: 30 additions and zero removals. Exact added rows are:

- Recovery authority creation/loading: `2098 filesystem-read:fs.lstat`, `2156 file-handle-lifecycle:FileHandle.sync`, `2157 file-handle-read:FileHandle.stat`, `2158 filesystem-read:fs.lstat`, `2208 filesystem-open:fs.open`, `2212 file-handle-read:FileHandle.stat`, `2213 filesystem-read:fs.lstat`, `2221 file-handle-read:FileHandle.stat`, `2222 filesystem-read:fs.lstat`.
- Recovery assessment/apply/retirement: `2457 filesystem-read:fs.lstat`, `2468 filesystem-lifecycle:fs.rename`, `2474 filesystem-lifecycle:fs.unlink`, `2483 filesystem-read:fs.lstat`, `2495 filesystem-lifecycle:fs.rename`, `2506 filesystem-open:fs.open`, `2507 file-handle-read:FileHandle.stat`, `2508 filesystem-read:fs.lstat`, `2513 file-handle-read:FileHandle.stat`, `2546 filesystem-read:fs.lstat`, `2555 filesystem-open:fs.open`, `2557 file-handle-read:FileHandle.stat`, `2558 filesystem-read:fs.lstat`, `2567 filesystem-lifecycle:fs.rename`, `2573 filesystem-lifecycle:fs.unlink`.
- Retained-stage/final-window publication: `2611 filesystem-open:fs.open`, `2614 file-handle:FileHandle.write`, `2697 file-handle-read:FileHandle.stat`, `2708 file-handle-read:FileHandle.stat`, `2726 file-handle-read:FileHandle.stat`, `2767 filesystem-lifecycle:fs.rename`.

### Existing `src/builder-install.js` row movements

All 85 prior rows remain with the same kind/callee. Exact old-to-current line movements are:

- Pre-transaction block: `1135→1312`, `1163→1340`, `1167→1344`, `1200→1377`, `1203→1380`, `1206→1383`, `1207→1384`, `1213→1390`, `1214→1391`, `1219→1396`, `1253→1430`, `1264→1441`, `1470→1647`, `1471→1648`, `1482→1659`, `1483→1660`, `1501→1678`, `1502→1679`, `1657→1834`, `1658→1835`, `1659→1836`, `1673→1850`, `1715→1892`, `1719→1896`, `1806→1983`, `1807→1984`, `1834→2011`, `1838→2015`, `1869→2046`, `1874→2051`, `1875→2052`, `1890→2067`, `1894→2071`.
- Staging/publication block: `1925→2154`, `1928→2590`, `1939→2625`, `1940→2626`, `1968→2667`, `1975→2679`, `1991→2698`, `1997→2709`, `2012→2727`, `2013→2728`, `2034→2751`.
- Receipt/host/retained-authority block: `2076→2822`, `2084→2830`, `2088→2834`, `2089→2835`, `2093→2839`, `2097→2843`, `2102→2855`, `2114→2872`, `2128→2887`, `2158→2917`, `2165→2924`, `2181→2940`, `2182→2941`, `2197→2956`, `2200→2959`, `2211→2970`, `2220→2979`, `2230→2989`, `2239→2998`, `2240→2999`, `2241→3000`, `2251→3010`, `2280→3039`, `2285→3044`, `2296→3055`, `2297→3056`, `2301→3060`, `2302→3061`, `2395→3154`, `2396→3155`, `2400→3159`, `2428→3187`, `2433→3192`, `2436→3195`, `2454→3213`, `2457→3216`, `2468→3227`, `2469→3228`, `2470→3229`, `2484→3243`, `2548→3307`.

### Existing `src/cli.js` row movements

The CLI has 35 current rows and 35 canonical rows; there are no semantic I/O additions or removals. Exact movements are:

- Durable loaders: `425→451`, `450→476`, `455→481`, `538→564`, `543→569`, `569→595`, `574→600`, `580→606`, `609→635`, `634→660`, `665→691`, `677→703`, `693→719`, `767→793`, `771→797`, `776→802`, `781→807`, `806→832`, `810→836`, `829→855`, `833→859`, `838→864`, `843→869`, `849→875`, `861→887`, `910→936`.
- Persistable/process output: `1746→1865`, `1758→1877`, `1771→1890`, `1849→1968`, `1853→1972`, `1857→1976`, `1861→1980`.
- Existing bounded reads: `2726→2845`, `2752→2871`.

## Decisions Made

- Recovery authority is part of transaction correctness, not an optional diagnostic. New setup is blocked while an exact outstanding record exists.
- A recovery preview is approval over exact observed state, not merely a list of pathnames; apply cannot recompute a different plan under the same caller request.
- Prior replacement state is retained by exact inode under a deterministic transaction-owned path so restart recovery never fabricates old bytes.
- Public output remains value-blind and explicitly `mechanism-recovery`; it does not certify domain quality, production readiness, or wider Codex/OpenClaw compatibility.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Retained exact old receipt authority for restart recovery**

- **Found during:** Task 2 old-receipt failure coverage.
- **Issue:** Reconstructing a prior receipt from recorded bytes would not restore its exact original inode and could not meet restart-safe exact-prestate semantics.
- **Fix:** Replacement entries now record a deterministic retained-prior path and exact identity; recovery restores the retained original inode.
- **Files modified:** `src/builder-install.js`, `test/builder-install-security.test.js`.
- **Verification:** Focused recovery suite passes, including same-device/inode restoration after interrupted inline rollback.
- **Commit:** none by execution contract.

**2. [Rule 1 - Bug] Closed retained recovery handles on every inspection and failure path**

- **Found during:** Task 2 hostile recovery test iteration.
- **Issue:** Early rejection paths could leave process-local `FileHandle` objects to garbage collection even though disk state was correctly preserved.
- **Fix:** Authority and retained-state handles now close explicitly on success and every rejection path without mutating preserved recovery evidence.
- **Files modified:** `src/builder-install.js`.
- **Verification:** Focused suites pass without FileHandle garbage-collection warnings.
- **Commit:** none by execution contract.

**Total deviations:** 2 auto-fixed (1 Rule 1, 1 Rule 2). Both were necessary for exact recovery correctness and bounded resource lifetime; neither expands the architecture or public scope.

## Deferred Issues

- `npm run check` passes every syntax gate and 676/678 tests. The only two failures are the whole-repository and Wave 16/17 canonical artifact/output inventory snapshots assigned to Plan 02-23.
- The exact I/O/import delta above is intentionally deferred to that single inventory reconciliation. No 02-23-owned inventory file was edited.

## Authentication Gates

None. No real Codex process, private locator, network access, credential path, release publication, or actual UAT was used.

## Known Stubs

None. The six implementation/test files contain no TODO, FIXME, placeholder, coming-soon, or goal-blocking empty UI/data source.

## Verification

- TDD RED — the new recovery imports failed before implementation, and hostile partial-prestate/final-window assertions reproduced the reviewed gaps.
- `node --test test/builder-install-security.test.js test/builder-cli.test.js test/builder-packed-install.test.js test/builder-lifecycle.test.js` — 89/89 pass; 8 suites; 0 failed, cancelled, skipped, or todo.
- `node --test --test-reporter=tap` — 676/678 pass; 71 suites; 0 cancelled, skipped, or todo. Only the two expected Plan 02-23 inventory snapshots fail.
- `npm run check` — all syntax checks pass; test result remains the same expected 676/678 inventory-only state.
- `git diff --check` — pass before summary creation.
- Stub scan — no goal-blocking stub found.

## Certification Boundary

This plan proves deterministic project transaction and recovery mechanics only. It does not prove cryptographic Codex origin, a real Codex install or activation, live session behavior, domain quality, Agent Package quality, production readiness, deployment approval, or wider Codex/OpenClaw compatibility. Existing declared-ready/live-success and birth-report evidence boundaries remain unchanged.

## User Setup Required

None.

## Next Phase Readiness

CR-03 and CR-04 are closed, packed recovery is complete-or-reject, and Plan 02-23 has the exact producer/loader/consumer plus static I/O/import delta needed for its single canonical inventory reconciliation. Real Codex UAT remains intentionally unperformed.

## Self-Check: PASSED

- All six plan-owned implementation/test files and this summary exist.
- Recovery schema/path constants and all three public recovery operations are exported; the CLI exposes only explicit inspect/preview/apply recovery routes.
- Focused verification passes 89/89; repository-wide failures remain exactly the two documented Plan 02-23 snapshots.
- No `.env`, real host state, private locator, network, release endpoint, GitHub, ROADMAP, STATE, REQUIREMENTS, or 02-23-owned inventory file was modified by this plan.
- Commit lookup is not applicable because commits were prohibited.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-21*
