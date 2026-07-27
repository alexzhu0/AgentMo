---
phase: 02-codex-builder
reviewed: 2026-07-23T08:56:22Z
depth: deep
files_reviewed: 17
files_reviewed_list:
  - src/builder-codex-uat.js
  - src/builder-codex-uat-continuation.js
  - src/builder-package.js
  - src/builder-behavior-eval.js
  - src/builder-install.js
  - src/builder-codex-host.js
  - src/builder-lifecycle.js
  - src/builder-hook-bridge.js
  - src/builder-append-only-authority.js
  - scripts/build-builder-uat-releases.js
  - scripts/verify-codex-uat-candidate.js
  - scripts/preflight-codex-uat-prior-attempt.js
  - src/cli.js
  - test/builder-codex-uat.test.js
  - test/builder-packed-install.test.js
  - test/codex-builder-behavior.test.js
  - release/2026.07.22.md
findings:
  critical: 6
  warning: 2
  info: 0
  total: 8
status: issues_found
---

# Phase 02: Code Review Report — Iteration 3

**Reviewed:** 2026-07-23T08:56:22Z
**Depth:** deep
**Files Reviewed:** 17
**Status:** issues_found

## Summary

This fresh, independent review traced the Phase 2 release-pair, UAT continuation, install, host observation, lifecycle, hook, behavior-evaluation, and append-only publication paths. The scoped regression tests pass, and several previously risky pair-provenance paths are now materially stronger. However, six correctness or evidence-integrity defects remain ship-blocking.

The dominant risks are: pathname syscalls are not actually bound to retained directory identities; a crash can leave a partial marketplace projection that no retry can converge; activation can commit after the published marketplace tree drifts; hook checkpoint publication is not linearized against deactivation; behavior evaluation does not re-admit its release pair or bind its baseline to lifecycle genesis; and test/fault controls remain reachable in shipped mechanisms.

**POC gate:** failed. A real Agent POC should not begin while any BLOCKER remains.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01: Retained-directory checks do not bind the pathname syscall that creates the effect

**Classification:** BLOCKER
**Files:** `src/builder-install.js:2651-2743`; `src/builder-lifecycle.js:625-657`; `src/builder-codex-uat.js:1632-1745`; `scripts/build-builder-uat-releases.js:292-348`

**Issue:** These publication paths validate a directory chain or staged file identity, then perform `open`, `link`, or directory-sync work through a pathname. The validation and the effect are separate syscalls. A same-UID process can replace the destination parent after validation, allow the pathname syscall to affect the replacement directory, and restore the original directory before the postcondition check. The operation can then reject while a hidden stage file or hard link remains in a displaced directory. That residual effect is not represented by the recovery authority.

**Reproduction path:**

1. Pause after the final parent/stage identity check and before the pathname `open` or `link`.
2. Rename the validated parent aside and put an attacker-controlled directory at the original pathname.
3. Resume through the pathname syscall, then restore the validated directory before the postcheck.
4. Observe that the operation rejects but the replacement or displaced directory retains the created entry.

**Impact:** The append-only and no-residual-effect guarantees are false under a reproducible local race. Unregistered bytes or links can survive a rejected operation, and recovery cannot enumerate or reconcile them.

**Minimal fix:** Route every create, link, rename-equivalent, and directory-sync effect through a private retained-directory capability, such as a narrowly scoped native helper using `openat`/`linkat`/`fsync` against already opened directory descriptors. Add cross-process tests that swap and restore the directory at the syscall boundary and assert that no effect appears outside the retained inode.

### CR-02: A crash during first marketplace projection permanently wedges exact retry

**Classification:** BLOCKER
**File:** `src/builder-install.js:345-493`, `src/builder-install.js:1684-1786`, `src/builder-install.js:941-1009`

**Issue:** Marketplace publication creates the root, directories, and files sequentially, but does not first publish a durable transaction manifest or record each member effect. The inspector accepts only an absent tree or the complete exact tree; a correct partial prefix is classified as foreign. Install recovery tracks project files, stages, and host reservation state, but not the identities and digests of marketplace members already published.

**Reproduction path:**

1. Start the first user-host setup with an absent marketplace projection.
2. Terminate the process after the root or first exact member is created.
3. Run recovery, which can supersede the project attempt but cannot claim the marketplace prefix.
4. Retry setup and observe that the partial exact prefix is classified as foreign and preparation rejects.

**Impact:** An ordinary interruption can make the host setup non-convergent without physical deletion. That violates the promised append-only retry model and blocks future activation.

**Minimal fix:** Publish a durable projection transaction manifest before the first filesystem effect, append each exact member identity and digest as it is created, and let an exact retry resume only the missing members. Extend recovery to validate and consume that manifest without deleting prior evidence. Add a member-by-member crash matrix proving convergence from every publication boundary.

### CR-03: Activation can commit after the marketplace tree has drifted

**Classification:** BLOCKER
**Files:** `src/builder-install.js:810-859`, `src/builder-install.js:1230-1245`, `src/builder-install.js:1378-1536`; `src/builder-codex-host.js:1403-1417`; `src/builder-behavior-eval.js:254-268`

**Issue:** The installer validates and publishes the exact marketplace projection, then performs later host observation and durable publication steps. The subsequent host observation checks canonical directories and source visibility, not the exact member set and digests. Immediately before the activated receipt, reservation release, and terminal append, the installer does not re-run an exact projection inspection. The receipt carries the earlier computed projection digest rather than a final binding to the current root and member identities.

**Reproduction path:**

1. Let exact marketplace publication complete.
2. Before activated-receipt publication, alter a runtime asset or marketplace metadata entry that the host observation does not digest.
3. Allow host observation, receipt publication, reservation release, and terminal append to complete.
4. Observe an `activated` terminal result whose stored projection digest describes the pre-drift tree.

**Impact:** Durable terminal evidence can claim activation for bytes that are no longer present. Later mechanism evidence inherits a false install premise.

**Minimal fix:** Retain authorities for the exact projection root and members, revalidate their identities and digests immediately before receipt publication, again before reservation release and terminal append/readback, and bind those final identities into the prepared attempt and activated receipt.

### CR-04: Hook checkpoint publication is not linearized against deactivation

**Classification:** BLOCKER
**Files:** `src/builder-hook-bridge.js:263-304`; `src/builder-lifecycle.js:283-315`; `src/builder-codex-uat-continuation.js:350-510`, `src/builder-codex-uat-continuation.js:739-850`; `test/builder-packed-install.test.js:1697-1762`

**Issue:** A hook performs its final lifecycle-admission check and then independently writes the checkpoint. Deactivation appends to a separate lifecycle authority and does not acquire a barrier on the checkpoint authority. The current race test pauses before the hook's production final check, so the resumed hook sees deactivation and rejects; it does not exercise the interval after the final check and before checkpoint compare-and-swap.

**Reproduction path:**

1. Let a hook pass its final lifecycle admission.
2. Pause it immediately before checkpoint publication.
3. Complete deactivation and append the tombstone.
4. Resume the hook and let it win checkpoint publication and observation.

**Impact:** Deactivation can report success while active checkpoint state or evidence is committed afterward. Recovery can see exact successors but cannot prove which operation linearized first.

**Minimal fix:** Put a deactivation barrier on the same checkpoint authority. Hooks must atomically prove active lifecycle state while publishing before that barrier; deactivation should close the barrier before committing its tombstone. Add a deterministic test seam exactly after the final lifecycle check and before the checkpoint CAS.

### CR-05: Behavior evaluation accepts a self-consistent but uncommitted release pair

**Classification:** BLOCKER
**Files:** `src/builder-behavior-eval.js:299-355`, `src/builder-behavior-eval.js:396-453`; `src/builder-codex-uat.js:314-352`; `test/builder-codex-uat.test.js:901-989`; `test/codex-builder-behavior.test.js:996-1021`

**Issue:** Behavior evaluation loads a structurally valid UAT journal and candidate and checks that they agree with each other and with the selected successor release. It does not re-admit the committed baseline/successor package-and-tarball pair, compare the journal baseline tuple with the lifecycle genesis receipt, or bind the setup receipt to that genesis. The journal loader proves immutable-chain shape, not that the chain was written for a committed release pair. Existing behavior tests mutate the candidate while retaining the original journal, so they miss a journal and candidate forged together.

**Reproduction path:**

1. Rebuild a valid candidate-ready journal with an arbitrary pair operation ID, pair digest, tarball digest, and baseline tuple.
2. Recompute predecessor digests, ordered evidence, candidate, and ready entries.
3. Supply a candidate that agrees with the rebuilt journal while keeping the selected successor and upgrade/deactivation fields acceptable.
4. Observe behavior evaluation accepting and emitting the arbitrary pair fields as an exact journal-candidate chain.

**Impact:** The evaluator can produce internally false mechanism evidence for a pair that was never committed and a baseline that was never the lifecycle genesis. The non-certifying booleans reduce downstream authority, but they do not make the evidence truthful.

**Minimal fix:** Require and re-admit the committed release set, including both retained/public package and tarball members and their commit record. Compare the full baseline tuple with lifecycle genesis and the full successor tuple with the selected release receipt. Add tests that mutate journal and candidate together and that alter only the baseline/genesis binding.

### CR-06: Shipped mechanisms still honor caller-controlled test and fault controls

**Classification:** BLOCKER
**Files:** `src/builder-install.js:713-740`, `src/builder-install.js:2878-2916`; `src/builder-codex-host.js:145-166`, `src/builder-codex-host.js:206-258`, `src/builder-codex-host.js:1550-1676`; `src/builder-hook-bridge.js:74-111`, `src/builder-hook-bridge.js:546-552`; `src/builder-lifecycle.js:283-305`; `src/builder-append-only-authority.js:1614-1647`; `src/builder-codex-uat-continuation.js:1164-1171`; `scripts/build-builder-uat-releases.js:36-37`, `scripts/build-builder-uat-releases.js:123-168`; `src/builder-package.js:295-317`, `src/builder-package.js:619-625`; `test/builder-packed-install.test.js:2051-2159`

**Issue:** Production-packaged functions and scripts accept `__testOnly*` seams, alternate host transports/state roots, stop checkpoints, interrupt controls, and synthetic release-admission functions. Most are protected only by the caller-controlled `NODE_TEST_CONTEXT`; the release-builder SIGKILL boundary is not consistently protected even by that check. Packed tests directly import and exercise these implementations, confirming that the controls are part of the shipped mechanism rather than an external test fixture.

**Reproduction path:**

1. Launch the packed module or operator script with a spoofed `NODE_TEST_CONTEXT`.
2. Pass the relevant test-only option or environment checkpoint.
3. Substitute synthetic host observation, redirect state, interrupt a continuation, or terminate release publication at the chosen boundary.
4. Observe behavior unavailable to the intended production mechanism, including false host evidence or partial durable output.

**Impact:** A caller who can invoke the shipped mechanism can alter its trust boundary and durable behavior with test controls. Evidence is no longer produced solely by the reviewed production path.

**Minimal fix:** Remove test-only option keys and fault environment variables from shipped modules and scripts. Put dependency injection and interruption orchestration in test-only fixtures outside package, Builder, runtime, and release inventories. Production functions should reject these keys unconditionally, and packed tests should prove that spoofed test environment variables have no effect.

## Warnings

### WR-01: Preflight direct-entry detection fails on valid paths containing URL metacharacters

**Classification:** WARNING
**File:** `scripts/preflight-codex-uat-prior-attempt.js:136-143`

**Issue:** The script constructs its entry URL with ``new URL(`file://${process.argv[1]}`)``. Valid filesystem paths containing `#`, `?`, or `%` can be parsed as a fragment, query, or escape sequence instead of literal path characters. The direct-entry comparison can then fail, silently skipping the preflight and exiting successfully.

**Reproduction path:** Run a copied checkout whose path contains `#` or `?`; invoke the preflight directly and observe that the main routine is not selected.

**Impact:** A valid checkout path can bypass a required preflight with a misleading zero exit.

**Minimal fix:** Resolve the entry path and convert it with `pathToFileURL`, then compare `.href`. Add direct-entry tests for `#`, `?`, `%`, and spaces.

### WR-02: The release record states guarantees contradicted by current implementation

**Classification:** WARNING
**File:** `release/2026.07.22.md:14-22`, `release/2026.07.22.md:54`

**Issue:** The release evidence claims convergence from all prefixes, retained-directory binding for stage/link/sync effects, exact behavior-chain pair binding, and exclusion of post-deactivation checkpoint mutation. CR-01 through CR-05 provide concrete counterexamples. Aggregate passing tests at line 54 do not exercise the missing syscall and lifecycle schedules.

**Reproduction path:** Compare each cited release claim with the corresponding code path and schedules in CR-01 through CR-05.

**Impact:** Operators can treat broader mechanism properties as established even though the evidence covers narrower deterministic paths.

**Minimal fix:** Narrow each claim to the exact exercised boundaries, list the unresolved schedules as remaining risk, and promote a claim only after the matching adversarial regression exists. Retain the existing caveat that mechanism evidence does not certify domain quality or production readiness.

## Verified Closures and Non-findings

- UAT start now admits both committed release members, requires matching operation and pair digests, persists the full release set, and rejects legacy pairless journals.
- Continuation re-admits the full successor release set and compares baseline, successor, operation ID, and pair digest.
- Candidate verification re-admits its package/tarball and the baseline/successor pair; cross-pair substitution tests cover both source and packed paths.
- Behavior field-isolation tests now change the named candidate field, so the prior no-op override defect is closed.
- Append-only record-stage abort now has an explicit durable branch and v2 outcome.
- Runtime manifest validation and lifecycle compatibility comparison no longer conflate the full plugin manifest with the version-normalized compatibility view.
- Hook-spawn static validation structurally parses invocation arguments rather than relying on a decoy-sensitive substring check.

## Verification Evidence

Focused command:

```text
node --test test/builder-codex-uat.test.js test/builder-packed-install.test.js test/codex-builder-behavior.test.js
```

Result: **PASS — 43/43 tests across 3 suites**.

This is a synthetic regression baseline only. No real Codex UAT, live provider/network call, or real Agent POC was run. No secret file was read. No source, test, release, or documentation file was modified by this review.

---

_Reviewed: 2026-07-23T08:56:22Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: deep_
