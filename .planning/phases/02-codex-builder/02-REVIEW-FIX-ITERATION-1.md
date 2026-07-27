---
phase: 02-codex-builder
fixed_at: 2026-07-22T08:01:11Z
review_path: .planning/phases/02-codex-builder/02-REVIEW.md
iteration: 1
findings_in_scope: 23
fixed: 23
skipped: 0
status: all_fixed
commit_policy: user-prohibited
---

# Phase 02: Code Review Fix Report

**Fixed at:** 2026-07-22T08:01:11Z
**Source review:** `.planning/phases/02-codex-builder/02-REVIEW.md`
**Iteration:** 1

**Summary:**

- Findings in scope: 23
- Fixed: 23
- Skipped: 0
- Focused verification: 159/159 tests passed across 22 suites
- Commits: none; the user explicitly prohibited git mutation and commits

The fixes preserve the controlling v1 contract: lifecycle state is append-only, deactivation is logical, historical bytes and evidence remain immutable, and purge or selector removal is unavailable. The passing checks establish bounded mechanism behavior only. They do not constitute real Codex UAT, domain-quality certification, production approval, or independent human verification of security-sensitive logic.

**Remaining Node pathname capability gap:** standard Node does not provide a portable handle-relative `openat`/`renameat`/`unlinkat` family or a portable no-replace rename primitive. AgentMo therefore does not claim pathname atomicity. The v1 mitigation is architectural: avoid physical deletion and canonical replacement, retain exact file and parent handles across admission, publish absent-only, revalidate identities, and fail closed while preserving every ambiguous or foreign entry. A future physical garbage-collection protocol would require separate authorization and a stronger platform-specific primitive set.

## Fixed Issues

### CR-01: The public lifecycle still implements uninstall and purge-equivalent host removal instead of deactivate plus tombstone

**Status:** fixed: requires human verification
**Files modified:** `src/cli.js`, `src/builder-lifecycle.js`, `src/builder-codex-host.js`, `src/builder-install.js`, `src/builder-codex-uat-continuation.js`, lifecycle/host/CLI tests, and current operator documentation
**Commit:** not created; git mutation was prohibited
**Applied fix:** Replaced physical uninstall semantics with predecessor-bound deactivate/reactivate records. The deprecated `uninstall` spelling is hidden and maps only to logical deactivation; purge, selector removal, and compensating host-removal commands fail closed.

### CR-02: Install and upgrade replace canonical releases and receipts instead of publishing immutable successors

**Status:** fixed: requires human verification
**Files modified:** `src/builder-install.js`, `src/builder-lifecycle.js`, and lifecycle/install security tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Releases and receipts now use immutable version-qualified publications and append-only activation successors. Existing canonical bytes are never replaced, moved, or unlinked.

### CR-03: A canonical prepared recovery file is sufficient authority to mutate the project

**Status:** fixed: requires human verification
**Files modified:** `src/builder-install.js`, `src/builder-append-only-authority.js`, and install/authority tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Recovery authority now distinguishes prepared records from committed outcomes. Prepared-only prefixes are surfaced as blocked recovery evidence and cannot authorize project mutation.

### CR-04: The immutable journal exposes and advances a successor before durable commit

**Status:** fixed: requires human verification
**Files modified:** `src/builder-immutable-journal.js`, `src/builder-checkpoint.js`, and immutable-journal/checkpoint tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Journal visibility is committed-marker gated. Readers do not advance from prepared entries, and crash recovery converges only after the entry, outcome, and parent-directory durability boundaries have been re-admitted.

### CR-05: Replace-capable retirement renames can displace or overwrite late foreign occupants

**Status:** fixed: requires human verification
**Files modified:** install, host, lifecycle, immutable-journal, and private-UAT authority modules plus hostile-race tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Removed replace-capable retirement from v1 shared/canonical paths. Publication uses absent-only links, ambiguity fails closed, and late foreign occupants remain untouched.

### CR-06: Pathname cleanup and release publication retain destructive final windows

**Status:** fixed: requires human verification
**Files modified:** install/host/UAT/package modules, `scripts/build-builder-uat-releases.js`, behavior evaluation, and hostile-window tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Removed automatic unlink/recursive-removal cleanup and retained operation-bound stages as evidence. Release output uses absent-only publication and preserves late occupants and exact retained bytes.

### CR-07: Unrecorded same-inode hardlinks are normalized as AgentMo-owned authority

**Status:** fixed: requires human verification
**Files modified:** `src/builder-append-only-authority.js`, host/journal/private-authority modules, `src/builder-package.js`, and hardlink-admission tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Authority admission now binds exact names, roles, parent identities, inode identities, digests, operation ids, and expected link sets. Extra or unregistered hardlinks fail closed.

### CR-08: Pre-publication failures leave unbound prepared bytes without durable aborted-attempt evidence

**Status:** fixed: requires human verification
**Files modified:** `src/builder-install.js`, `src/builder-append-only-authority.js`, and install/authority tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Every install attempt receives durable append-only authority before staging and a committed or aborted terminal outcome. Orphaned prepared prefixes are discoverable and cannot be silently bypassed.

### CR-09: Private UAT authority reports premature commit, accepts a stale publication binding, and wedges after crash

**Status:** fixed: requires human verification
**Files modified:** `src/builder-codex-uat-private-authority.js` and prior-attempt/private-authority tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Private UAT publication now separates prepared and committed state, jointly revalidates retained handles and path bindings, and deterministically re-admits or rejects crash prefixes without rename or unlink.

### CR-10: Uninstall-arm publication can wedge on fixed remnants and accepts an unproven second hardlink

**Status:** fixed: requires human verification
**Files modified:** `src/builder-codex-uat-continuation.js`, lifecycle/private-authority helpers, and packed continuation tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** The continuation now uses an exact absent-only deactivation arm bound to registered authority. Fixed remnants and foreign or extra links are rejected without mutation.

### CR-11: The packed continuation lacks a recovery matrix and is not idempotent after completion

**Status:** fixed: requires human verification
**Files modified:** `src/builder-codex-uat-continuation.js`, `src/builder-codex-uat.js`, packed package/CLI tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Added restart-safe continuation admission, exact replay, and terminal idempotency. Six SIGKILL boundaries and completed-replay behavior are covered without duplicate publication.

### CR-12: Ordinary callers can self-mint terminal human-admission

**Status:** fixed: requires human verification
**Files modified:** `src/builder-codex-uat.js`, `src/cli.js`, and UAT/CLI tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Caller-reported decisions are nonterminal evidence only. Terminal candidate admission requires the exact verifier-owned authority path and cannot be minted from ordinary CLI input.

### CR-13: Behavior UAT can splice a handwritten candidate and unrelated receipt into a false 11/11 result

**Status:** fixed: requires human verification
**Files modified:** `src/builder-behavior-eval.js`, `src/builder-codex-uat.js`, `src/cli.js`, and behavior/UAT tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Connected behavior evaluation exact-admits the journal head, candidate, install receipt, current consumer ledger, and ordered evidence chain. Handwritten, unrelated, or stale candidates fail closed. The mechanism-only evaluator now consumes the already-admitted installed release after lifecycle v2.

### CR-14: Hook delivery replay is not idempotent after observation publication

**Status:** fixed: requires human verification
**Files modified:** `src/builder-hook-bridge.js`, `plugin/hooks/agentmo-hook.js`, and hook-bridge tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Hook delivery records and re-admits the exact observation digest, recognizes exact completed replay, and rejects mismatched replays without republishing or mutating state.

### CR-15: Candidate-ready cannot transition to bounded failure or interruption

**Status:** fixed: requires human verification
**Files modified:** `src/builder-codex-uat.js`, `src/builder-codex-uat-continuation.js`, and UAT transition tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Candidate-ready remains nonterminal and may advance to exactly one mutually exclusive bounded failure or interruption terminal. Reverse edges, duplicates, and incompatible terminals are rejected.

### CR-16: Release admission omits part of the packed/plugin executable and data closure

**Status:** fixed: requires human verification
**Files modified:** `src/builder-package.js`, `scripts/build-builder-uat-releases.js`, `package.json`, package-security/packed-install tests, and I/O inventory
**Commit:** not created; git mutation was prohibited
**Applied fix:** Static closure now covers ESM, CJS/JSON secondary loaders, workers, forks, plugin entrypoints, adjacent launchers, and manifest data. Release-set v2 binds exact public/retained tarball hardlink pairs to an independently published commit record; the generic reader remains strict at one link.

### CR-17: Windows drive-qualified paths escape the UAT evidence-root boundary

**Status:** fixed: requires human verification
**Files modified:** `src/builder-codex-uat.js`, `src/cli.js`, and UAT/CLI platform tests
**Commit:** not created; git mutation was prohibited
**Applied fix:** Evidence references reject drive-qualified, UNC, absolute, and mixed-separator forms. Builder dispatch fails closed on unsupported Windows while non-Builder commands remain available.

### WR-01: Hostile and crash tests miss the true final effect windows and encode unsafe recovery as success

**Status:** fixed
**Files modified:** append-only authority, install, host, lifecycle, UAT, continuation, package, and hostile-race test suites
**Commit:** not created; git mutation was prohibited
**Applied fix:** Added syscall-adjacent process-kill coverage, late-occupant and inode-swap races, exact replay, completed continuation, and foreign-path preservation assertions.

### WR-02: Historical lifecycle contracts and the I/O inventory still authorize superseded destructive behavior

**Status:** fixed
**Files modified:** lifecycle/host/install tests, `test/artifact-surface-coverage.test.js`, and `test/helpers/io-surface-inventory.js`
**Commit:** not created; git mutation was prohibited
**Applied fix:** Current executable contracts and the exact inventory now reject physical delete, canonical replacement, and remove commands. Historical planning artifacts were deliberately left unchanged.

### WR-03: The package advertises generic Node support while core diagnosis is POSIX-only

**Status:** fixed
**Files modified:** `package.json`, `src/cli.js`, `src/builder-doctor.js`, CLI/doctor tests, and current documentation
**Commit:** not created; git mutation was prohibited
**Applied fix:** Added an explicit Builder-only POSIX platform contract for Darwin and Linux. Unsupported Builder dispatch is rejected on Windows without incorrectly disabling unrelated AgentMo commands.

### WR-04: README UAT commands are rejected by the current CLI

**Status:** fixed
**Files modified:** `README.md`, `docs/MVP_RUNBOOK.md`, `docs/AGENTMO_MVP_LEDGER.md`, `docs/OMX_SESSION_MIGRATION.md`, and `test/command-docs.test.js`
**Commit:** not created; git mutation was prohibited
**Applied fix:** Maintained examples now use the current append-only CLI and carry their own required preflight and exact digest bindings.

### WR-05: The release index omits the current Phase 02 records

**Status:** fixed
**Files modified:** `release/README.md` and `release/2026.07.22.md`
**Commit:** not created; git mutation was prohibited
**Applied fix:** Added and indexed the current review/fix release record with explicit aggregate-pending/mechanism-only boundaries. It does not claim real UAT, domain quality, or production readiness.

### WR-06: Obsolete security-sensitive static analyzers remain beside the canonical analyzer

**Status:** fixed
**Files modified:** `src/javascript-static-analysis.js`, package/static-closure tests, and exact I/O inventory
**Commit:** not created; git mutation was prohibited
**Applied fix:** Removed legacy analyzer authority and consolidated executable-closure checks on the canonical scanner and its exact inventory.

## Skipped Issues

None.

## Verification Evidence

- `node --test test/artifact-surface-coverage.test.js` — 17/17 passed.
- Focused Phase 02 aggregate — 159/159 passed across 22 suites.
- `npm run check` — 672/672 passed across 75 suites.
- `git diff --check` — passed.
- No real UAT was run.

---

_Fixed: 2026-07-22T08:01:11Z_
_Fixer: Codex (gsd-code-fixer)_
_Iteration: 1_
