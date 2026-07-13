---
phase: 01-canonical-artifact-kernel
plan: 04
subsystem: migration-filesystem
tags: [migration, filesystem, retained-handles, fail-closed, cli]
dependency_graph:
  requires:
    - 01-02 canonical identity and three-stage contract
    - 01-03 closed migration registry and deterministic preview
  provides:
    - capability-gated explicit migration apply
    - path-bound committed output verifier
    - value-blind CLI apply results and errors
  affects:
    - Phase 1.1 artifact admission and persistence safety
    - Phase 1.2 Node runtime evidence
tech_stack:
  added: []
  patterns:
    - retained file and directory handles
    - no-follow exclusive pre-open
    - committed-marker-last publication
    - independent fail-closed verification
key_files:
  created:
    - src/migration-filesystem.js
    - test/helpers/migration-parent-swap-child.js
    - release/2026.07.11.md
  modified:
    - src/cli.js
    - test/artifact-migration.test.js
    - test/cli.test.js
decisions:
  - Use direct 0700 output staging and never claim pathname-atomic rename semantics.
  - Treat only a fresh verifyMigrationOutput success as official apply success.
  - Preserve identity-uncertain orphan staging and never recursively delete replacement paths.
  - Reject output parents that are also source-containing directories.
metrics:
  duration: not-recorded
  completed: 2026-07-12
status: complete
---

# Phase 01 Plan 04: Capability-Gated Migration Apply Summary

Explicit migration apply now publishes deterministic canonical payloads and receipt through retained exclusive handles, commits a path-bound marker last, and reports success only after a fresh fail-closed verifier accepts the complete output.

## What Was Built

### Task 1: Capability-gated retained-handle publisher

- Added a platform capability gate that runs before output mkdir and requires current-uid ownership, safe parent mode, no-follow/open flags, stable BigInt dev/ino, source file sync, and retained directory sync support.
- Revalidates the exact in-memory plan against no-follow source reads before staging.
- Rejects source symlinks, changed/reordered inputs, unsafe parent/output aliases, and output-parent/source-container identity overlap before mutation.
- Creates only an absent dedicated output directory with mode 0700.
- Pre-opens marker, every canonical payload, and deterministic receipt with create/exclusive/write-only/no-follow flags before writing any payload bytes.
- Writes exact bytes with positional short-write handling, syncs retained handles, writes the receipt after payloads, and writes/syncs committed marker state last.
- Binds the marker to an opaque instance token, requested-path digest, plan digest, and precise parent/directory identities.
- Added verifyMigrationOutput, which reopens and rebinds the requested path, validates committed marker and deterministic receipt bytes, enforces the exact file set and owner-only modes, and checks every canonical digest.
- Any final verifier failure restores staging state through the already-validated retained marker handle.
- Identity loss returns AGENTMO_MIGRATION_ORPHANED_STAGING with an opaque token. No recursive deletion or pathname cleanup is attempted.

### Task 2: CLI apply and evidence

- Kept migration preview as the default portable behavior.
- Added explicit --out parsing and apply wiring for both human and JSON output.
- Added stable value-blind result/error envelopes for committed success, output-exists, whole-batch rejection, unsupported platform, apply failure, and orphaned staging.
- Added deterministic repeated-apply coverage: canonical payloads and receipt are byte-identical across different absent outputs; the instance marker is allowed to differ.
- Added release/2026.07.11.md with only observed command results, hashes, architecture decisions, non-certification boundaries, and remaining platform risk.

## Security and Adversarial Evidence

- Capability rejection was proven to occur before output mkdir.
- Unsafe writable parent, symlink parent, existing output alias, source symlink, changed source, reordered batch, and source-container overlap all fail closed.
- Every output open, logical write, and sync ordinal in the single-payload publication path was injected and shown unable to produce verifiable success.
- Four cross-process parent swaps were exercised: immediately after mkdir, after the first output handle, before receipt, and before marker commit.
- Replacement parent/output sentinels remained intact; moved owned staging stayed mode 0700 and could not be verified after either move or restoration.
- Marker state/field tamper, receipt digest/reformat tamper, payload digest/mode/symlink tamper, extra files, and requested-path moves all caused verifier failure.
- A dedicated RED reproduced a formerly resurrectable committed marker after final-verifier failure. GREEN remediation now decommits through the retained marker handle, and later removal of the transient cause cannot restore verifier success.
- Source evidence snapshots covered bytes, containing entries, dev/ino, mode, link count, owner/group, size, mtime, and ctime across success and injected failures.
- Errors, receipt, marker, CLI result, release evidence, and this summary contain no migration source path/basename, raw content, raw transcript/output material, or credential values.

## Verification

Observed in this implementation session:

- node --test test/artifact-migration.test.js — PASS, 62/62.
- node --test test/artifact-migration.test.js test/cli.test.js — PASS, 80/80.
- node --test test/artifact-migration.test.js test/cli.test.js test/canonical-identity.test.js test/stage-contracts.test.js — PASS, 94/94.
- npm run check — PASS, syntax gates and 277/277 tests.
- git diff --check — PASS both before and after release/summary creation.

The observed runtime was Node v24.18.0. This is not direct Node 20 runtime-lane evidence.

## TDD Gate Compliance

- Filesystem import RED: module absent.
- Minimal publisher RED: 20/21 with committed verification unimplemented.
- Expanded adversarial RED: 21/51 before retained-handle publication.
- CLI apply RED: 0/3 while --out remained preview-only.
- CLI targeted GREEN: 3/3.
- Final-verifier decommit RED: failed apply could initially be revalidated after restoring conditions.
- Decommit and parent-swap targeted GREEN: 6/6.

Normal RED/GREEN commits were not created because the executor assignment explicitly prohibited staging and committing.

## Deviations from Plan

### Auto-fixed Issues

1. Rule 1 — Closed a resurrectable committed-marker bug found during adversarial review.
   - Final verification originally occurred outside the catch-protected retained-handle region.
   - The final verifier now runs while retained ownership is still available, and any failure restores staging state before returning.

2. Rule 2 — Added identity-confirmed cleanup guards.
   - A directory/file handle opened during a pathname race is never used for chmod or marker restoration until post-open path/handle binding proves it is the owned object.

3. Rule 2 — Added source-container identity exclusion.
   - Explicit apply now refuses an output parent that is the same directory identity as any source parent, preserving containing entries.

These fixes narrow the trust surface without adding a new lifecycle stage, dependency, or automatic migration path.

## Safety Boundaries Preserved

- Standard Node has no portable openat, renameat, or unlinkat. This implementation does not claim absolute pathname atomicity.
- Preview remains available when apply capabilities are unsupported.
- Capability failure does not degrade to a weaker writer.
- No source file is opened for write, renamed, deleted, or metadata-restored.
- Failed staging may be conservatively retained even when its current identity is still known.
- Identity-uncertain replacement paths are never recursively deleted or treated as owned.
- Receipt, marker, apply output, and release evidence are mechanism evidence only.
- declared-ready remains deterministic wiring evidence only; live-success remains one isolated runtime execution only. Neither certifies domain quality or production readiness.

## Remaining Risk

- A real Node 20 lane was not executed in this environment; Phase 1.2 retains that evidence obligation.
- Portable Node pathname operations cannot eliminate every race window. Repeated handle/path identity checks and the closed verifier guarantee fail-closed reporting when uncertainty is observed, not pathname atomicity.
- Unsupported filesystems return AGENTMO_MIGRATION_PLATFORM_UNSUPPORTED before output mkdir.
- Identity loss intentionally leaves a 0700 orphan staging directory and requires a future token-aware recovery workflow.

## Commits

Skipped by explicit assignment. No files were staged and no commits were created.

## Known Stubs

None.

## Self-Check: PASSED

- Publisher, CLI wiring, adversarial helper/tests, release evidence, and this summary exist.
- No staging, commit, branch, worktree, STATE, ROADMAP, or REQUIREMENTS mutation occurred.

---
Phase: 01-canonical-artifact-kernel
Completed: 2026-07-12
