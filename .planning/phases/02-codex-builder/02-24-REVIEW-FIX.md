---
phase: 02-codex-builder
fixed_at: 2026-07-21T10:58:56Z
review_path: .planning/phases/02-codex-builder/02-24-REVIEW.md
iteration: 2
findings_in_scope: 7
fixed: 7
skipped: 0
status: all_fixed
---

# Phase 02 Plan 24: Code Review Fix Report

## Iteration 2 — 2026-07-21T10:58:56Z

**Source review:** `.planning/phases/02-codex-builder/02-24-REVIEW.md`

**Findings in scope:** 6 Critical/BLOCKER findings and 1 Warning

**Result:** 7 fixed, 0 skipped. Commits were not created because this round explicitly prohibited git mutations.

### CR-01: Uncommitted private continuation authority

**Files modified:** `src/builder-codex-uat-private-authority.js`, `test/builder-codex-uat-prior-attempt.test.js`

**Status:** fixed; requires human verification of concurrency semantics

Prepared authority bytes now become consumable only after a deterministic commit marker is linked and synced. Cleanup after that linearization point cannot retire the committed final. Continuation publication returns its exact sequence/digest admission even if another writer advances the chain. Barrier regressions prove an uncommitted linked entry is invisible and an exact committed successor is returned.

### CR-02: Live immutable append rollback

**Files modified:** `src/builder-immutable-journal.js`, `test/builder-checkpoint.test.js`

**Status:** fixed; requires human verification of concurrency semantics

A linked journal entry is now irreversible. A failure after publication returns committed/recovery-required only when the canonical entry is still the operation-owned inode; same-byte foreign replacements remain rejected. A three-party barrier test proves writer C can advance writer A's linked entry and writer A cannot later remove the predecessor.

### CR-03: Host owner/ledger pathname CAS races

**Files modified:** `src/builder-codex-host.js`, `test/builder-codex-host.test.js`

**Status:** fixed; requires human verification of filesystem race semantics

The shared owner/ledger write path retains operation-owned inode anchors across prior retirement and final publication, verifies the post-effect inode, and preserves ambiguous cleanup competitors. State admission normalizes only exact retained sibling links inside the private state root. Effect-adjacent barriers cover publication, prior retirement, and stage cleanup.

### CR-04: Install stage cleanup replacement deletion

**Files modified:** `src/builder-install.js`, `test/builder-install-security.test.js`

**Status:** fixed; requires human verification of filesystem race semantics

Install publication links from a retained exact-inode anchor. Cleanup first moves the reusable stage pathname and deletes it only when the moved entry still matches the retained handle; a replacement is retained as inert evidence. True final publication and cleanup seams prove foreign bytes survive while the admitted artifact publishes.

### CR-05: Recovery authority and replay races

**Files modified:** `src/builder-install.js`, `test/builder-install-security.test.js`

**Status:** fixed; requires human verification of recovery logic

Recovery authority is written to a private stage, write-all checked, file-synced, identity checked, linked absent-only, and parent-directory-synced before mutation. Loaders require current-user ownership, safe ancestor modes, and exact `0600` authority mode. Replay retirement/restoration holds exact handles and hard-link anchors across effects, retaining competitors rather than adopting or deleting them. Tests cover staged write/sync interruption, unsafe mode, and post-validation replacement.

### CR-06: Post-uninstall restart gap

**Files modified:** `src/builder-codex-uat-continuation.js`, `test/builder-packed-install.test.js`

**Status:** fixed; requires human verification of restart-state logic

The packed continuation now publishes and syncs a value-blind `uninstall-armed` record before uninstall. It binds the journal head, approved plan, checkpoint, release, receipt/launcher digests, shared runtime digest, and preserved paths. On restart it rejects mixed state, distinguishes exact pre-state from verified post-uninstall absence, and idempotently finishes the observation/candidate chain. A fresh child process interrupted immediately after uninstall resumes from the unchanged 10-scenario head and reaches `candidate-ready` with `status: recovered`.

### WR-01: Pre-revalidation tests mislabeled as final-window coverage

**Files modified:** `test/builder-codex-host.test.js`, `test/builder-install-security.test.js`, `test/builder-packed-install.test.js`

**Status:** fixed

New seams run after the last revalidation and immediately before the relevant effect. Positive hostile cases preserve foreign inodes while committed canonical state remains exact; rejection cases preserve both admitted and competitor evidence.

### Iteration 2 inventory and verification

- `test/helpers/io-surface-inventory.js` was synchronized to every changed production I/O surface.
- Focused private authority, checkpoint, host, install-security, and packed continuation tests passed.
- `node --test test/artifact-surface-coverage.test.js` — 15/15 passed.
- `npm run check` — 699/699 passed across 72 suites.
- `git diff --check` — passed.

### Iteration 2 boundaries

No `.env`, private locator, retained real attempt, real UAT, Codex session, network, GitHub, or external publication surface was accessed. Synthetic race and restart evidence remains mechanism-only and non-certifying.

---

## Iteration 1 history (preserved)

**Fixed at:** 2026-07-21T09:59:47Z

**Source review:** `.planning/phases/02-codex-builder/02-24-REVIEW.md`

**Iteration:** 1

## Summary

- Findings in scope: 2 Critical/BLOCKER findings
- Fixed: 2
- Skipped: 0
- Commits: none; staging and commits were explicitly prohibited

## Fixed Issues

### CR-01: Concurrent continuation transitions create a durable fork instead of one CAS winner

**Files modified:** `src/builder-codex-uat-private-authority.js`, `test/builder-codex-uat-prior-attempt.test.js`, `test/helpers/io-surface-inventory.js`

**Status:** fixed; requires fresh independent review of the concurrency logic

**Applied fix:** Continuation successors now publish to one deterministic sequence slot (`.continuation.transition.NNNNNN.json`) rather than contender-specific digest filenames. Each contender first creates and syncs a random exclusive stage, then competes through an absent-only hard link to the single slot. The loader enforces that exact sequence filename, predecessor digest, sequence increment, and legal state edge. A test-only barrier stops two different legal successors immediately before their final-link CAS; the regression proves exactly one fulfills, exactly one rejects, only one sequence-1 successor exists, the winner reloads, and the admitted chain can advance to and reload sequence 2.

### CR-02: Private authority failure cleanup can unlink a foreign replacement inode

**Files modified:** `src/builder-codex-uat-private-authority.js`, `test/builder-codex-uat-prior-attempt.test.js`, `test/helpers/io-surface-inventory.js`

**Status:** fixed; requires fresh independent review of the filesystem race logic

**Applied fix:** Private authority publication no longer writes or unlinks a final pathname directly. It holds a random exclusive stage open through complete write, file sync, exact inode/size checks, absent-only final link, parent sync, and exact binding rechecks. Cleanup and successful stage retirement use rename into a retained mode-0700 private directory; post-rename inode checks detect a final-window replacement while preserving the moved foreign inode instead of deleting it. Hostile regressions cover a short write, a pre-sync failure, and replacement after the final identity check but before cleanup rename. They prove the canonical pathname remains absent/unloadable after failure and the foreign bytes plus `dev`/`ino` survive in retained evidence.

## I/O Inventory

`test/helpers/io-surface-inventory.js` was synchronized to the scanner's actual line-numbered I/O set for `src/builder-codex-uat-private-authority.js`. The current private-authority closure contains 38/38 classified surfaces, including staged open/write/sync, absent-only `link`, retained-directory `mkdir`, identity reads, and two rename retirement paths. The removed pathname `unlink` surface is absent. Exact repository discovered/allowlisted equality remains green with zero pending or unclassified rows.

## Verification Evidence

- `node --check src/builder-codex-uat-private-authority.js` — pass
- `node --check test/builder-codex-uat-prior-attempt.test.js` — pass
- `node --test test/builder-codex-uat-prior-attempt.test.js` — 5/5 pass
- `node --test test/artifact-surface-coverage.test.js` — 15/15 pass
- `node --test test/builder-codex-uat-prior-attempt.test.js test/artifact-surface-coverage.test.js test/builder-package-security.test.js test/builder-packed-install.test.js` — 47/47 pass across 4 suites
- `npm run check` — 692/692 pass across 72 suites; 0 fail, cancelled, skipped, or todo
- `git diff --check` — pass

## Remaining Boundaries

- These fixes and disposable synthetic tests prove bounded mechanism behavior only. They do not certify domain quality, Agent Package quality, production readiness, deployment approval, or wider Codex/OpenClaw compatibility.
- No historical locator, retained real attempt, `.env`, real UAT root, Codex process/session, network endpoint, or GitHub surface was accessed.
- The retained directory intentionally keeps inert cleanup evidence rather than deleting by pathname. Loaders admit only the fixed canonical receipt/continuation names and ignore retained entries.
- Plan 02-24 still requires a fresh independent zero-Critical review before validation, public maintenance records, locator access, or UAT may advance.

---

_Fixed: 2026-07-21T09:59:47Z_

_Fixer: the agent (gsd-code-fixer)_

_Iteration: 1_
