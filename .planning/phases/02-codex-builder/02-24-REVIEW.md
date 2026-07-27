---
phase: 02-codex-builder
reviewed: 2026-07-21T11:06:00Z
depth: standard
files_reviewed: 26
files_reviewed_list:
  - scripts/preflight-codex-uat-prior-attempt.js
  - scripts/verify-codex-uat-candidate.js
  - src/builder-checkpoint.js
  - src/builder-codex-host.js
  - src/builder-codex-uat-continuation.js
  - src/builder-codex-uat-private-authority.js
  - src/builder-codex-uat.js
  - src/builder-hook-bridge.js
  - src/builder-immutable-journal.js
  - src/builder-install.js
  - src/cli.js
  - test/artifact-surface-coverage.test.js
  - test/builder-checkpoint.test.js
  - test/builder-cli.test.js
  - test/builder-codex-host.test.js
  - test/builder-codex-uat-prior-attempt.test.js
  - test/builder-codex-uat.test.js
  - test/builder-hook-bridge.test.js
  - test/builder-hook.test.js
  - test/builder-install-security.test.js
  - test/builder-lifecycle.test.js
  - test/builder-packed-install.test.js
  - test/codex-builder-behavior.test.js
  - test/helpers/io-surface-inventory.js
  - release/2026.07.21.md
  - package.json
findings:
  critical: 8
  warning: 2
  info: 0
  total: 10
status: issues_found
---

# Phase 02: Code Review Report

**Reviewed:** 2026-07-21T11:06:00Z
**Depth:** standard
**Files Reviewed:** 26
**Status:** issues_found

## Summary

The full Plan 02-18 through 02-23 union and the second repair iteration's production, test, inventory, package, and release surfaces were re-reviewed from the current bytes. `npm run check` passes 699/699 tests across 72 suites, but the implementation still contains eight blocking publication/recovery defects. Most are final-effect races that the current seams stop immediately before the effect or immediately after a pathname check, leaving the actual `rename`/`unlink` window untested.

The principal risks are false durable-commit reporting, a prepared private transition that can permanently occupy the deterministic successor slot, unqualified hardlinks being accepted as retained authority, and foreign inodes being overwritten or unlinked during cleanup/recovery. The release record therefore cannot yet claim these races are closed.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Private commit markers are reported committed before durable sync and are loaded through a publication/marker TOCTOU

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-private-authority.js:644-667,716-770,799-844`
**Issue:** `publishExclusiveFile` sets `committed = true` immediately after linking the commit marker, then explicitly suppresses a failure from `root.handle.sync()`. The catch path consequently returns `committed-recovery-required` even when the marker directory entry was never durably synced. Separately, `loadCommittedAuthorityFile` closes the publication handle before loading the marker and never reopens/revalidates the publication afterward, so a same-byte inode swap between the two reads mints an admission for an inode no longer at the canonical path. A crash after the data final is synced but before its marker is linked also leaves an ignored prepared final occupying the deterministic sequence slot; the next writer cannot link its successor and there is no fresh-process recovery record that can prove and retire the orphan.

**Fix:** Treat the commit point as marker link **plus successful retained-root sync plus post-sync exact binding checks**. Keep both publication and marker handles open through one combined admission, recheck both canonical path bindings after reading, and persist an operation-bound prepared record that lets a fresh process either finish the exact marker or retire the exact orphan without touching competitors.

### CR-02: Immutable journal successors become visible and advanceable before the documented durable commit point

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:159-216,252-303,497-579`
**Issue:** The loader admits a linked successor while the writer's lock/stage identify an active append. Another writer can advance that successor at the `after_entry_link` barrier before the first writer has synced the parent. If the first writer then throws, lines 256-273 mint a committed head solely from the two-link inode and lines 301-303 suppress a later parent-sync failure. This contradicts the journal contract that a committed result exists only after publication and retained-parent sync; after a crash the supposedly committed predecessor may not exist even though a later successor already references it.

**Fix:** Add a prepared/final marker (or an equivalent durable state bit) to the journal. Loaders may inspect a prepared successor for recovery but must not expose it as a legal predecessor until the final marker and parent directory are synced. Never map a failed parent sync to `committed:true`; recovery must finish the exact operation or return an explicit indeterminate/recovery-required state that callers cannot advance.

### CR-03: Host owner/ledger cleanup still unlinks pathnames after their final identity check

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:895-914,1400-1437,1479-1482,1645-1689`
**Issue:** The repair adds anchors and post-validation seams, but it still performs pathname `unlink` after the last binding check: retained restore checks line 912 then unlinks line 913; prior/stage anchors are unlinked at lines 1411/1437 and unconditionally again in `finally`; stage cleanup verifies the moved path at line 1685 then unlinks at line 1688. A competitor replacing any of these names after the check is deleted. The current hostile seams occur before rename/link effects, not between the last post-effect identity check and the unlink.

**Fix:** Do not unlink retained evidence or anchors by pathname. End cleanup after exact rename into a private retained directory, or use another non-replaceable capability/descriptor-based removal primitive. If physical deletion is required, introduce an operation-owned directory entry protocol whose final effect cannot target a subsequently replaced name, and place the hostile seam at that true final effect.

### CR-04: Host state accepts every same-inode sibling as authorized retained evidence

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:1531-1573`
**Issue:** `countAuthorizedStateRetainedLinks` counts every regular sibling in the shared state root that has the same `(dev, ino)`, regardless of filename, operation id, reservation, or retained-record provenance. `retainExactFile` then subtracts this count from the expected canonical link count. An arbitrary extra hardlink such as `foreign-copy` is therefore normalized as if it were operation-owned retained evidence, defeating the one-authority/nlink admission boundary and making later retirement decisions rely on unauthenticated links.

**Fix:** Count only retained entries named and bound by a closed reservation/recovery record, and validate their exact role, operation id, predecessor/publication digest, inode and safe metadata. Reject every unrecorded same-inode sibling.

### CR-05: Normal install cleanup retains the old lstat-to-unlink race

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2760-2828`
**Issue:** After publication, the stage cleanup renames to a random retained pathname, checks it with `lstat`/`handle.stat`, and then unlinks it. The publication anchor follows the same pattern at lines 2793-2796. A competitor can replace either retained pathname after the check and before `unlink`, causing foreign data loss while the install still proceeds. The `after-stage-cleanup-revalidation` seam is before the rename, so it cannot exercise this actual deletion window.

**Fix:** Keep exact cleanup artifacts as inert retained evidence instead of unlinking them. If bounded cleanup is needed, use an operation-private directory plus a non-path-replaceable deletion design; add barriers immediately before the true final deletion and assert the competitor inode survives.

### CR-06: Install recovery rename effects can overwrite foreign destination or retained evidence

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2136-2247,2525-2603,2646-2679`
**Issue:** Recovery authority publication renames its stage to a retained path without retaining the parent or proving the retained target absent at the effect. Replay retirement checks the retained target only before opening/anchoring and later `rename(destination, retained)` can overwrite a competitor created in the gap. Restore checks the canonical destination absent before the seam and then `rename(retainedPath, destination)` can overwrite a late foreign file. Authority retirement has the same check-then-rename pattern. Post-rename comparison detects that the wrong inode moved, but the overwritten inode is already lost.

**Fix:** Make every recovery move absent-only. Publish through a retained exact source handle and a deterministic operation record, reserve destinations with `link`/CAS semantics, and preserve any occupant. Never use replacing `rename(source, destination)` when `destination` is attacker/competitor-reachable. Retain and revalidate the parent handle through the directory sync and terminal recovery assessment.

### CR-07: `uninstall-armed` is neither interruption-safe before publication nor foreign-inode-safe

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:492-545`
**Issue:** The restart authority uses fixed `.stage` and `.retained` names without retained parent identity. A crash after stage sync but before final link leaves `.stage`, while `loadUninstallArm` returns null and the next publication fails `O_EXCL` forever. `rename(stage, retained)` can overwrite an existing foreign retained inode. The loader proves only that the final has `nlink === 2`; it never opens/revalidates the retained sibling, rechecks the file after reading, or proves the two names identify the same admitted inode. Thus the record used to cross uninstall is not a closed staged-retained authority.

**Fix:** Use a random exclusive stage and an operation-bound recovery record under a retained safe directory handle. Link the final absent-only, sync the parent, retain the exact stage inode without overwriting, and on restart verify both links/bytes/identities before either completing or safely retiring the operation. Add interruption tests before link, after link, after retention, and before/after directory sync.

### CR-08: Candidate/observation leaf cleanup can unlink a final-window replacement

**Severity:** BLOCKER
**File:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat.js:1604-1624,1720-1777`
**Issue:** Both `unlinkExactLeafBinding` and `unlinkOperationOwnedStage` validate the pathname and then call `unlink` with no authority held over that directory entry. A replacement between the check and unlink is deleted. These helpers are used for successful stage retirement and rollback of both candidate and observation leaves, so a failed publication can remove foreign evidence despite the retained-parent work.

**Fix:** Replace pathname unlink with exact rename into inert retained evidence and stop there, or introduce a final capability-bound deletion protocol. Add hostile barriers after the last binding check and immediately before each cleanup effect for both success and rollback paths.

## Warnings

### WR-01: Hostile regressions do not reach the true final effect windows they claim to cover

**Severity:** WARNING
**File:** `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-host.test.js:919-989; /Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:310-427; /Users/alexzhu/Lenovo/AgentMo/test/builder-packed-install.test.js:1342-1599`
**Issue:** The tests inject at phases named `after-...-revalidation`, but production performs another pathname lookup or a replacing `rename`/`unlink` afterward. They do not inject between lines 1685/1688 in host cleanup, 2795/2796 or 2826/2828 in install cleanup, at recovery destination replacement, during commit-marker parent sync, or before uninstall-arm stage link/retention. Passing tests therefore do not substantiate the advertised final-window guarantees.

**Fix:** Add deterministic barriers at each actual last-check/effect pair and assert exact bytes plus `(dev, ino)` for canonical, admitted, retained, and foreign entries. Include process termination—not only thrown exceptions—at prepared/publication/commit boundaries.

### WR-02: The release record states the races are closed despite unresolved blocking paths

**Severity:** WARNING
**File:** `/Users/alexzhu/Lenovo/AgentMo/release/2026.07.21.md:5-13`
**Issue:** The record says all six critical races are closed and that effect-adjacent seams prove competitor preservation. CR-01 through CR-08 above show that commit durability, cleanup deletion, recovery overwrite, and uninstall-arm restart windows remain open. This overstates the mechanism evidence and conflicts with the project's fail-closed release semantics.

**Fix:** After repairing and independently re-reviewing the code, rewrite the release entry to describe only the guarantees actually proved. Until then, mark the review gate as blocked and list the remaining publication/recovery risks.

---

_Reviewed: 2026-07-21T11:06:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
