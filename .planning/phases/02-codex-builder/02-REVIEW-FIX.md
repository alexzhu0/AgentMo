---
phase: 02-codex-builder
fixed_at: 2026-07-22T11:35:10Z
review_path: .planning/phases/02-codex-builder/02-REVIEW.md
iteration: 2
findings_in_scope: 11
fixed: 11
skipped: 0
status: all_fixed
aggregate_tests: 712
aggregate_suites: 76
actual_node20_lane: not_run
real_uat: not_run
commit_policy: user-prohibited
---

# Phase 02: Code Review Fix Report — Iteration 2

**Fixed at:** 2026-07-22T11:35:10Z
**Source review:** `.planning/phases/02-codex-builder/02-REVIEW.md`
**Iteration:** 2

**Summary:**

- Findings in scope: 11 — 10 Critical and 1 Warning
- Fixed: 11
- Skipped: 0
- Aggregate verification: 712/712 tests passed across 76 suites
- Commits: none; the user explicitly prohibited git mutation and commits

The fixes preserve the controlling Builder v1 contract: shared authorities are
append-only, publication is absent-only, lifecycle selection is immutable,
deactivation is logical, and historical bytes remain evidence rather than
cleanup targets. Passing tests establish bounded local mechanism behavior only.
They do not constitute real Codex UAT, cryptographic Codex origin, domain-quality
certification, production approval, wider OpenClaw compatibility, or independent
human verification.

The supported Builder mechanism remains Darwin/Linux with a current numeric UID
and nonzero `O_DIRECTORY` and `O_NOFOLLOW` constants. There is no unresolved
platform blocker on that declared boundary. Unsupported platforms or missing
capabilities fail closed before Builder stdin, filesystem, or child-process
effects.

## Fixed Issues

### CR-01: Competing appends and record-stage interruptions permanently poison the shared authority

**Status:** fixed

**Files modified:** `src/builder-append-only-authority.js`,
`src/builder-posix-effect.js`, `test/builder-append-only-authority.test.js`, and
the exact I/O inventory.

**Applied fix:** The shared sequence claim is now published before
operation-specific record data. Claim-only, prepared, committed, and aborted
prefixes are registered immutable states. A losing idempotency key cannot leave
an unregistered stage that poisons fresh readers, and exact retry or abort closes
an interrupted claim without deleting evidence.

**Verification:** `test/builder-append-only-authority.test.js` passed 35/35,
including different-key contention, claim-only recovery, prepared-prefix
recovery, and 17 syscall-adjacent SIGKILL cases.

### CR-02: Pathname publication is not bound to the retained directory authority

**Status:** fixed

**Files modified:** `src/builder-posix-effect.js`,
`src/builder-append-only-authority.js`, `src/javascript-static-analysis.js`,
`src/builder-package.js`, and append/package tests.

**Applied fix:** Stage creation, symlink claim, hard-link publication, and parent
sync execute in a dedicated child that changes into the admitted directory and
retains the opened directory inode across the effect. The parent no longer
represents pre/post pathname checks as effect binding. Identity-change-and-restore
schedules are rejected without a residual effect in the replacement directory.

**Verification:** The append-only suite passed 35/35, including all retained
directory write/link boundaries and directory identity restoration cases. The
packed static closure includes the POSIX helper and its shared platform gate.

### CR-03: A selected immutable upgrade cannot be used by hook, doctor, or behavior admission

**Status:** fixed

**Files modified:** `src/builder-lifecycle.js`, `src/builder-hook-bridge.js`,
`src/builder-doctor.js`, `src/builder-behavior-eval.js`,
`src/builder-package.js`, `test/builder-lifecycle-v1.test.js`,
`test/builder-doctor.test.js`, and `test/codex-builder-behavior.test.js`.

**Applied fix:** One canonical `admitBuilderLifecycleSelection()` resolves the
active genesis or immutable successor path, digest, package root, release
identity, lifecycle head, and lineage. Hook, Doctor, behavior, package, and UAT
consumers use that selected object. Compatible metadata/version successors are
usable; a runtime-changing successor fails closed. Doctor separately preserves
read-only owned-path remediation when asset drift makes aggregate lifecycle
health corrupt.

**Verification:** Lifecycle v1 passed 5/5, installed hook admission passed 6/6,
Doctor passed 20/20, packed genesis/successor coverage passed 2/2, and the
connected UAT selection case passed 1/1.

### CR-04: Interrupted and partially published installs have no supported convergence path

**Status:** fixed

**Files modified:** `src/builder-install.js`, `src/cli.js`,
`test/builder-install-security.test.js`, `test/builder-cli.test.js`, and packed
install tests.

**Applied fix:** Recovery re-admits exact recorded stage identities, digests,
published links, receipt state, and any host reservation. It can close the exact
reservation, append a non-deleting `superseded` terminal outcome, reuse only
registered exact bytes, and start a new setup without removing the interrupted
transaction. Repeated interruptions carry inherited stage provenance forward.

**Verification:** Install security passed 22/22. Fresh-process interruption was
covered after attempt append, each stage sync, prepared append, each managed
publication, receipt publication, host reservation, and terminal append. The
CLI recovery surface passed its inspect/preview/apply and closed-syntax cases.

### CR-05: A durable host claim without its matching append makes host state permanently inconsistent

**Status:** fixed

**Files modified:** `src/builder-codex-host.js` and
`test/builder-codex-host.test.js`.

**Applied fix:** A valid claim for the exact next host-state head is admitted as
a recoverable prepared state instead of an inconsistent orphan. The same request
can finish the generic append from a fresh process; a conflicting request remains
rejected without poisoning later reads or retracting marketplace evidence.

**Verification:** The host contract passed 12/12, including fresh-process death
after host-claim sync, interruption during the shared authority append, competing
reservation claims, and exact retry.

### CR-06: Formal UAT combines package identity and tarball identity without proving they belong together

**Status:** fixed

**Files modified:** `src/builder-package.js`, `src/builder-codex-uat.js`,
`src/builder-codex-uat-continuation.js`,
`scripts/build-builder-uat-releases.js`, UAT/package tests, and packed fixtures.

**Applied fix:** Formal UAT now consumes a structured committed release-member
admission. It requires the expected baseline/successor role, the exact
retained/public inode pair, package name, version, release digest, tarball digest,
manifest digest, verifier digest, continuation digest, and a bounded valid
gzip/USTAR archive whose extracted package bytes match that tuple. Formal paths
do not use the generic single-link fallback, and baseline/successor must be two
members of the same committed release operation.

**Verification:** UAT passed 18/18, package release-member focus passed 6/6, and
packed verifier admission passed 1/1. Swapped pairs, wrong roles, uncommitted
members, non-archives, and unrelated package roots fail before journal mutation.

### CR-07: Candidate-ready exact retry rejects the legitimate scenarios-complete input head

**Status:** fixed

**Files modified:** `src/builder-codex-uat-continuation.js` and
`test/builder-packed-install.test.js`.

**Applied fix:** The deactivation arm and continuation validation bind the
pre-deactivation head, canonical final-scenario head, and candidate-ready head.
The final-scenario digest is derived from canonical entry bytes rather than an
undefined convenience property. An exact retry with any head that was a legal
input to the committed operation returns the same result with zero mutation;
unrelated heads still fail.

**Verification:** The full packed final-deactivation, duplicate, and crash
recovery case passed 1/1 and also passed inside the final aggregate run.

### CR-08: Release-set commit publication is not a durable retained authority

**Status:** fixed

**Files modified:** `scripts/build-builder-uat-releases.js`,
`src/builder-package.js`, `test/builder-package-security.test.js`, and packed
release tests.

**Applied fix:** The producer syncs one retained commit stage and publishes those
exact bytes to the public path with an absent-only hard link. It syncs the npm
pack directory before member publication, then the public member parent and both
commit parents in the declared order. Before success it revalidates bytes, inode,
link count, and retained/public parent identities. Consumers require the same
two-link authority pair.

**Verification:** Package security passed 24/24. Six directory-sync crash
prefixes, public-commit identity drift, parent identity drift, same-byte inode
replacement, extra links, and late occupants all retained bounded fail-closed
outcomes.

### CR-09: Direct and internal Builder entrypoints bypass the Darwin/Linux platform gate

**Status:** fixed

**Files modified:** new `src/builder-platform.js`; public Builder modules;
`src/cli.js`; `plugin/hooks/agentmo-hook.js`; release producer, verifier, and
private preflight scripts; `src/builder-posix-effect.js`; `package.json`; and
`test/builder-platform.test.js`.

**Applied fix:** One shared `assertBuilderPlatform()` is the first effect gate for
public/internal CLI dispatch, installed hook runner, direct scripts, the POSIX
child, and exported Builder I/O or mutation APIs. It requires Darwin/Linux,
current numeric UID ownership, and exact nonzero `O_DIRECTORY` and `O_NOFOLLOW`;
zero fallbacks were removed. Unsupported simulations reject before stdin,
directory creation, path admission, npm execution, or child spawning.

**Verification:** The shared platform matrix passed 9/9. Runtime compatibility
seams passed 8/8 and explicitly inventory the platform-gated POSIX child spawn.

### CR-10: Hook checkpoint commits are not linearized with deactivation and its recovery arm

**Status:** fixed

**Files modified:** `src/builder-hook-bridge.js`,
`src/builder-codex-uat-continuation.js`, `test/builder-hook-bridge.test.js`, and
packed continuation tests.

**Applied fix:** Hook delivery revalidates lifecycle head, active receipt, and
checkpoint head immediately before checkpoint commit. Continuation publishes its
recovery arm before the tombstone and validates a bounded sequence of exact hook
successors plus the final deactivation challenge. A paused hook cannot append an
ordinary post-deactivation checkpoint; recovery converges from the allowed
pre-tombstone interleavings.

**Verification:** Hook bridge passed 6/6, including the lifecycle/deactivation
barrier. The packed final-deactivation continuation, exact replay, and
fresh-process recovery case passed in the aggregate suite.

### WR-01: Public UAT help labels journal files as attempt directories

**Status:** fixed

**Files modified:** `src/cli.js`, `README.md`, `docs/MVP_RUNBOOK.md`,
`release/2026.07.22.md`, `test/builder-cli.test.js`, and
`test/command-docs.test.js`.

**Applied fix:** `--journal` and `--uat-journal` consistently advertise
`<journal-file>`. `<attempt-dir>` is reserved for packed continuation and verifier
commands that derive `attempt.journal` internally. Tests distinguish an existing
directory from its admitted journal child.

**Verification:** Focused CLI placeholder coverage passed 2/2. Final maintained
documentation plus canonical-identity coverage passed 19/19.

## Skipped Issues

None.

## Verification Evidence

- `node --test test/builder-append-only-authority.test.js` — 35/35 passed.
- `node --test test/builder-platform.test.js` — 9/9 passed.
- `node --test test/builder-doctor.test.js` — 20/20 passed.
- `node --test test/artifact-surface-coverage.test.js` — 17/17 passed; 480 exact hardened I/O surfaces were owned.
- `node --test test/runtime-compatibility-seams.test.js` — 8/8 passed.
- `node --test test/command-docs.test.js test/canonical-identity.test.js` — 19/19 passed.
- `npm run check` — 712/712 passed across 76 suites with zero failures.
- `git diff --check` — passed after report convergence.
- The actual Node 20 core lane remained explicitly not run; its test marker is `# SKIP` and no runtime-promotion receipt was produced.
- No real UAT, network access, `.env` or secret read, stage, commit, tag, push, package publication, or deployment was performed.

## Remaining Boundaries

- Independent iteration-2 code re-review and goal-backward verification remain pending.
- Real authenticated Codex UAT and independent external human decision authority remain pending.
- Local mechanism evidence does not certify host behavior, Agent Package quality, domain quality, production readiness, deployment approval, or wider Codex/OpenClaw compatibility.

---

_Fixed: 2026-07-22T11:35:10Z_
_Fixer: Codex_
_Iteration: 2_
