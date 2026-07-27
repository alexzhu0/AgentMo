---
phase: 02-codex-builder
reviewed: 2026-07-22T03:47:43Z
depth: deep
partition: filesystem-transactions-lifecycle
files_reviewed: 18
files_reviewed_list:
  - AGENTS.md
  - .planning/phases/02-codex-builder/02-CONTEXT.md
  - .planning/phases/02-codex-builder/02-RESEARCH.md
  - .planning/phases/02-codex-builder/02-24-REVIEW.md
  - .planning/phases/02-codex-builder/02-24-REVIEW-FIX.md
  - src/builder-install.js
  - src/builder-lifecycle.js
  - src/builder-codex-host.js
  - src/builder-immutable-journal.js
  - src/builder-checkpoint.js
  - src/builder-events.js
  - test/builder-install-security.test.js
  - test/builder-lifecycle.test.js
  - test/builder-codex-host.test.js
  - test/builder-checkpoint.test.js
  - test/builder-hook.test.js
  - test/helpers/io-surface-inventory.js
  - test/artifact-surface-coverage.test.js
findings:
  critical: 9
  warning: 2
  info: 0
  total: 11
status: issues_found
---

# Phase 02: Filesystem Transactions and Lifecycle Review

**Reviewed:** 2026-07-22T03:47:43Z
**Depth:** deep
**Files Reviewed:** 18
**Status:** issues_found

## Summary

This partition traced install, publication, recovery, rollback, upgrade, uninstall, host-selector removal, immutable-journal admission, and cleanup effects through their callers and hostile tests. The submitted implementation does not implement the required v1 lifecycle contract. It still removes canonical assets, replaces existing releases and receipts, submits Codex removal commands, advances `prepared` state, and physically unlinks temporary/evidence pathnames. Several `rename` and `unlink` effects remain open to same-user final-window replacement, while the tests either stop before the actual effect or explicitly accept displacement of a foreign canonical occupant.

Nine defects are shipping blockers: three are direct product-contract violations, four are filesystem authority/atomicity failures, one exposes unsynced journal state as a legal predecessor, and one loses the durable aborted-attempt narrative. No additional raw-secret or non-value-blind evidence write was proven in the scoped `builder-events`/checkpoint serialization paths; that does not mitigate the lifecycle failures below. No source or test file was modified, and no real UAT, network, `.env`, or Git operation was performed.

## Narrative Findings (AI reviewer)

## Critical Issues

### FS-CR-01: Uninstall physically retires every canonical asset instead of appending a deactivation tombstone

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1586-1601`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1917-1948`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1301-1451`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:2816-2851`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:2854-2951`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-lifecycle.test.js:261-285`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-lifecycle.test.js:667-709`

**Mechanism:** `prepareUninstall` emits `delete` for every receipt-owned file and for the receipt itself. `applyLifecycle` dispatches those operations to `unlinkExactFile`, which delegates to `retireExactLifecyclePath`; line 2935 renames the canonical pathname into quarantine. The bytes may survive elsewhere, but the canonical installation, receipt, and agent paths are made absent and the result advertises `projection-removed`. The tests require this absence and therefore encode the obsolete destructive contract.

**Impact:** v1 uninstall is not deactivate/tombstone. Existing installation bytes stop being addressable at their recorded paths, history is hidden behind private quarantine names, and downstream readers cannot distinguish an append-only deactivation from physical retirement. This directly violates the release rule that purge is absent in v1.

**Minimal safe fix direction:** Remove `delete` operations and the uninstall retirement path from the v1 public API. Leave every installed byte and receipt at its original immutable/versioned path, append a predecessor-bound deactivation/tombstone record, and make active resolution consult that record. Do not expose purge or canonical-path retirement in v1.

**Deterministic reproduction/test:** Install a project, record every managed path's bytes and `(dev, ino)`, invoke the approved uninstall flow, and assert all original paths and identities still exist plus exactly one new tombstone entry. The current test at lines 261-285 instead observes the receipt and agent file as `ENOENT`, and the test at lines 667-709 explicitly proves the admitted inode was moved out of its canonical path.

### FS-CR-02: Install and upgrade replace canonical releases and receipts instead of publishing append-only successors

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:1695-1738`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:1782-1828`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2914-3035`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1524-1583`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1917-1948`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:2708-2781`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-host.test.js:1610-1660`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-lifecycle.test.js:153-177`

**Mechanism:** activation explicitly classifies a v2 receipt as `receipt-owned-replace`, moves the old canonical receipt to a retained location, and links v3 at the same canonical path. Lifecycle upgrade similarly emits `replace`, quarantines each old canonical file, links the successor at the old pathname, then unlinks its stage name. The tests assert the canonical receipt changes from v2 to v3 and the upgraded receipt reports version `0.2.0` at the same path.

**Impact:** install/upgrade is not append-only. Previously authoritative paths change meaning, old versions become private implementation debris rather than addressable history, and a partial replacement can leave a mixed release even when old bytes survive. Exact-digest approval does not make replacement compatible with the required v1 data model.

**Minimal safe fix direction:** Publish each release and receipt under an immutable, digest/version-qualified path using absent-only creation. Append a small predecessor-bound activation record that selects the active version; never move or overwrite the prior version. Re-activation of identical bytes should append nothing.

**Deterministic reproduction/test:** Install v1/v2, snapshot all canonical paths and identities, activate/upgrade to a distinct release, and require the snapshots to remain unchanged while new versioned paths and one activation entry appear. Current tests at `builder-codex-host.test.js:1617-1639` and `builder-lifecycle.test.js:153-177` prove replacement at the canonical locations instead.

### FS-CR-03: Public host lifecycle and rollback execute purge-equivalent Codex removals

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:94-168`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:787-865`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:254-317`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:765-857`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:1071-1174`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-host.test.js:2577-2634`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-host.test.js:2675-2710`

**Mechanism:** `mutateCodexHost` accepts `plugin-remove` and `marketplace-remove` and submits official `codex plugin remove` commands. Host-selector removal runs both commands, retires the marketplace projection, and retracts owner/ledger canonical files. Host projection migration removes the baseline before adding its successor. Install rollback also automatically runs both removal commands and retires the projection.

**Impact:** v1 contains a functional purge path even though purge must not exist. Uninstall and failed activation can delete or rewrite host-owned state outside the project, and the code cannot prove what the external Codex command physically removed. Retained AgentMo metadata does not undo external deletion.

**Minimal safe fix direction:** Remove all `*-remove` operations from the v1 mutation enum and public lifecycle surface. Represent inactive ownership/consumption with append-only tombstones and leave the host projection present but inactive. Failed activation should append an aborted/deactivated record; it must not issue compensating delete commands.

**Deterministic reproduction/test:** Use the existing stateful transport, deactivate the last project, and assert no command whose argv contains `remove` is submitted, projection/owner/ledger bytes retain their identities, and one tombstone is appended. The current test at lines 2692-2710 expects both remove commands, missing host state, and a missing projection.

### FS-CR-04: A canonical `phase: prepared` recovery file is sufficient authority to mutate the project

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:127-185`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2136-2250`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2269-2336`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:260-307`

**Mechanism:** recovery authority is permanently serialized with `phase: "prepared"`. Publication links that file at the canonical recovery path at line 2220, renames its sibling, and only then attempts the parent-directory sync at line 2230; there is no committed marker or state transition. The loader requires `phase === "prepared"`, and `applyBuilderInstallRecovery` immediately uses that record to retire created files or restore prior files. The test reads a prepared record and successfully advances recovery from it.

**Impact:** an unsynced/prepared intent becomes executable authority. A crash or sync error after the canonical link but before durable commit can leave a record that a restart treats as approved mutation state, violating the rule that prepared state may be inspected for recovery but cannot advance a workflow. The same record format cannot distinguish a fully committed recovery decision from an interrupted preparation.

**Minimal safe fix direction:** Publish a separate, append-only committed marker only after the prepared bytes and parent entries are durably synced and revalidated. Loaders may report an uncommitted prepared record as recovery-required, but planning/apply must refuse to mutate from it. Bind the marker to the exact authority digest, identity, operation id, and predecessor.

**Deterministic reproduction/test:** Add a barrier immediately after line 2224 and before line 2230, terminate the writer, restart, and attempt `plan/applyBuilderInstallRecovery`. The correct result is non-advancing `prepared/recovery-required`; the current shape and test at lines 285-307 make it applicable and mutate every published path to absence.

### FS-CR-05: A linked but unsynced journal successor is loadable and can become another writer's legal predecessor

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:159-216`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:252-321`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:497-580`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-checkpoint.js:138-182`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-checkpoint.test.js:224-270`

**Mechanism:** the publication hard link is created at line 167, while the parent directory is not synced until line 188. `loadWithParent` nevertheless reads that linked publication and mints it as `head`; `writeBuilderCheckpoint` treats every result other than `rejected-before-commit` as committed. The catch path can also mint `committedHead` from the link alone. The regression test deliberately pauses at `after_entry_link`, loads the unsynced entry, appends a successor from it, and asserts both writes are committed.

**Impact:** prepared state is externally visible and advanceable. A crash can erase the directory entry that an already-committed successor references, producing a chain that was never durably predecessor-bound. The existing test is direct proof of the prohibited behavior, not proof of recovery safety.

**Minimal safe fix direction:** Add a committed marker/state bit whose own directory entry is successfully synced and jointly revalidated with the publication before `load` exposes it as `head`. A linked-only entry may be recoverable evidence, but must never mint a predecessor admission or return `committed: true`.

**Deterministic reproduction/test:** Preserve the current two-writer barrier, but change the required outcome: while writer one is paused after link and before parent sync, `load` must return the previous head with `recoveryRequired: true`, and writer two must reject the prepared admission. Only after the committed marker sync may sequence 1 be advanced.

### FS-CR-06: Replace-capable `rename` effects displace or overwrite late foreign occupants after validation

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2525-2597`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2646-2678`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:3294-3356`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:135-190`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:1391-1411`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:2921-2951`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:953-989`

**Mechanism:** recovery checks a destination/retained path, runs a seam, then uses ordinary POSIX `rename`; a late destination is replaceable, so `restoreRecoveryPriorPath` can destroy a foreign canonical file at line 2589 and retirement can destroy a foreign retained target at line 2549. Receipt rollback validates A, runs `before-rollback-commit`, never revalidates the canonical receipt, and renames whatever now occupies it into quarantine. Host and lifecycle retirement have the same final check-to-replacing-rename shape. Detection after the move is too late because the foreign directory entry has already been displaced or overwritten.

**Impact:** a same-user competitor can lose its canonical pathname or, for an existing destination of file-to-file rename, its only link and bytes. Failing closed after the rename does not restore foreign ownership. This is both a data-loss risk and an authorization bypass over shared pathnames.

**Minimal safe fix direction:** Do not use replace-capable rename from or to shared/canonical paths. Publish only to absent, versioned destinations with absent-only hard links (or an equivalent no-replace primitive), retain sources without unlinking, and stop on any destination occupancy. Directory projections need immutable versioned roots rather than canonical swaps.

**Deterministic reproduction/test:** The existing `before-rollback-commit` seam can swap B into the receipt path. The correct assertion is that B remains at that exact canonical path with the same `(dev, ino)`; the current test instead requires the path to be absent and accepts B in quarantine. For recovery, inject B at the canonical destination during `after-recovery-restore-revalidation`; current line 2589 overwrites it, while a safe implementation must leave both B and the retained prior untouched.

### FS-CR-07: Cleanup still unlinks attacker-replaceable pathnames after the last identity check

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2760-2829`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:3019-3024`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:865-914`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:1400-1481`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:1645-1689`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:398-426`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-host.test.js:919-955`

**Mechanism:** install moves a stage/anchor to a retained name, calls `lstat`/`handle.stat`, then unlinks the pathname. Host state cleanup does the same after `exactOpenFileAtPath`; it also unconditionally unlinks anchor names in `finally`. None of those checks owns the directory entry across the final `unlink`. The named hostile seams occur before the rename/link effects, not between the final post-effect check and deletion.

**Impact:** a replacement created after the check is physically deleted, including a foreign file with unrelated bytes. Even without a race, the cleanup contradicts the v1 no-physical-delete rule and destroys the operation's own exact evidence rather than retaining an append-only account.

**Minimal safe fix direction:** End cleanup after an absent-only move/link into an operation-owned mode-0700 retained evidence tree and never unlink it in v1. If bounded garbage collection is ever introduced, make it a separate, explicit future purge protocol with independently authorized directory-entry capabilities.

**Deterministic reproduction/test:** Add a barrier after lines 2795/2827 and immediately before 2796/2828, and after host line 1685 immediately before 1688. Replace the retained name with B during the barrier; assert B survives at that exact name and identity. Current tests inject at `after-...-revalidation`, before the retained name even exists, so they cannot exercise the deletion window they claim to cover.

### FS-CR-08: Unrecorded same-inode hardlinks are normalized as AgentMo-owned authority

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:1887-1903`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2283-2298`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-host.js:1531-1574`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:583-604`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-immutable-journal.js:989-995`

**Mechanism:** host state counts every regular same-inode sibling in the shared state root as an authorized retained link, with no name, operation, reservation, or record binding. Install accepts attacker-chosen names containing `.agentmo-recovery-` or the retained prefixes. The journal counts every regular same-inode file found in its retained directory. Each loader then subtracts those unproven links from the expected `nlink` count.

**Impact:** a same-user process can manufacture extra hardlinks that the loader treats as AgentMo evidence, defeating the one-authority link-count boundary. Later retirement, cleanup, or admission decisions can proceed while an untracked alias exists, and a foreign alias can keep an inode alive or make an otherwise inconsistent authority appear valid.

**Minimal safe fix direction:** Bind every allowed sibling basename, parent identity, `(dev, ino)`, role, operation id, and predecessor/digest in a durable operation record. Count only those exact entries after opening and revalidating them; reject every unrecorded additional link regardless of filename prefix or directory placement.

**Deterministic reproduction/test:** Hardlink a valid host owner file to `foreign-copy` in the state root, a recovery authority to `.agentmo-recovery-foreign`, and a journal publication to `retained/foreign-copy`. Each subsequent loader must reject. Current host code counts the first unconditionally, install accepts the attacker-selected prefix, and journal accepts every regular retained entry.

### FS-CR-09: Pre-publication failures leave unbound prepared bytes but no durable `aborted` attempt evidence

**Severity:** BLOCKER
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2136-2250`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:438-444`
- `/Users/alexzhu/Lenovo/AgentMo/src/builder-install.js:2885-2894`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:310-330`

**Mechanism:** recovery-authority construction writes the only attempt description to a random `.stage-<transactionId>` path. If the injected failure occurs after its write or sync but before the canonical link, the catch/finally only closes the handle; it neither appends an `aborted` record nor binds the orphan stage into discoverable recovery state. Desired-file stages are merely renamed to random `aborted-retained` names. The next prepare checks only the canonical recovery path and therefore cannot associate these bytes with a failed attempt. The test asserts only that the canonical path is absent.

**Impact:** failed attempts are not auditable as aborted transactions. Exact bytes can remain as anonymous debris while a later attempt proceeds as if no predecessor existed, so release/evidence ledgers cannot explain the failure or prove which staged bytes belonged to it.

**Minimal safe fix direction:** Establish an append-only attempt entry before staging, bind every stage/authority digest and identity to it, and append a terminal `aborted` entry on every pre-commit failure. Preserve all exact bytes under operation-qualified paths; loaders must surface an unterminated attempt instead of silently ignoring it.

**Deterministic reproduction/test:** Throw at `after-recovery-authority-stage-sync`, enumerate `.agentmo/builder`, then start a new plan. Require one loadable `aborted` attempt that references the exact orphan stage digest/identity and require the new attempt to chain from it. The current test only observes canonical absence and the next planner has no authoritative record of the failed transaction.

## Warnings

### FS-WR-01: Hostile regressions are named as final-window coverage while stopping before the real effect or accepting foreign displacement

**Severity:** WARNING
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:398-426`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-install-security.test.js:922-989`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-codex-host.test.js:861-989`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-lifecycle.test.js:711-801`
- `/Users/alexzhu/Lenovo/AgentMo/test/builder-checkpoint.test.js:224-270`

**Mechanism:** install/host tests call pre-rename seams “actual final effect windows,” so the subsequent last check-to-`unlink` gap is never scheduled. Receipt rollback tests define “preserved B” as B being removed from the canonical pathname and found somewhere in quarantine. The checkpoint test positively requires a linked but unsynced entry to be visible and advanceable. Lifecycle tests exercise before-move and after-publication points, not the uninstrumented final check-to-rename interval.

**Impact:** the suite can remain green while the exact prohibited effects ship. Its assertions make future correct append-only/no-displacement behavior look like a regression.

**Minimal safe fix direction:** Put deterministic barriers at every actual last-check/effect pair, assert both pathname and `(dev, ino)` preservation for foreign entries, and reverse the journal/lifecycle expectations to the v1 contract. A competitor moved to quarantine is not “preserved” for ownership purposes.

**Deterministic reproduction/test:** For each existing `actual final` test, record the source line of the effect reached after the seam. Fail the test unless no pathname lookup/delete/replace effect remains after that barrier. Add an assertion that foreign B remains at its original path, not merely somewhere in the tree.

### FS-WR-02: Phase contracts and the I/O inventory still authorize the superseded destructive lifecycle

**Severity:** WARNING
**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/.planning/phases/02-codex-builder/02-CONTEXT.md:23-36`
- `/Users/alexzhu/Lenovo/AgentMo/.planning/phases/02-codex-builder/02-RESEARCH.md:59-72`
- `/Users/alexzhu/Lenovo/AgentMo/.planning/phases/02-codex-builder/02-RESEARCH.md:80-89`
- `/Users/alexzhu/Lenovo/AgentMo/.planning/phases/02-codex-builder/02-24-REVIEW-FIX.md:38-60`
- `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:5-16`
- `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:746-878`
- `/Users/alexzhu/Lenovo/AgentMo/test/artifact-surface-coverage.test.js:163-180`

**Mechanism:** the Phase context/research still specifies upgrade/uninstall as three-way mutation of pristine bytes and lists destructive lifecycle commands as the BLDR-06 proof. The repair report claims final-window cleanup safety even though production still calls pathname `unlink`. The I/O inventory treats `rename`, `rm`, `rmdir`, and `unlink` as ordinary `gated` surfaces, and the coverage test checks only discovered/allowlisted equality plus labels; it has no rule that forbids physical deletion, replacement, or purge.

**Impact:** planning, implementation, and CI all point maintainers back toward the obsolete behavior. A green exact-surface inventory demonstrates syntactic accounting, not compliance with the append-only/deactivation contract, so release evidence can be overstated again.

**Minimal safe fix direction:** Update the Phase lifecycle decision and BLDR-06 proof to immutable install/upgrade plus deactivate/tombstone semantics. Add a semantic policy test that rejects delete/remove operations and canonical replacement in v1 production modules; keep the inventory as a separate enumeration check rather than treating `gated` as safe.

**Deterministic reproduction/test:** Introduce a fixture containing one production `unlink` or `plugin-remove` call that is exactly allowlisted. The current coverage test passes; the required semantic policy test must fail and name the forbidden v1 operation.

---

_Reviewed: 2026-07-22T03:47:43Z_
_Reviewer: gsd-code-reviewer (filesystem transactions/lifecycle partition)_
_Depth: deep_
