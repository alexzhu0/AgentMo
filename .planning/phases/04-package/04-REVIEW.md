---
phase: 04-package
reviewed: 2026-07-30T05:12:58Z
depth: standard
files_reviewed: 51
files_reviewed_list:
  - docs/AGENTMO_MVP_LEDGER.md
  - docs/AGENT_BIRTH_GATE.md
  - docs/MVP_RUNBOOK.md
  - docs/OPENCLAW_RUNTIME_NOTES.md
  - docs/STAGE_CONTRACTS.md
  - release/2026.07.29.md
  - release/2026.07.30.md
  - release/README.md
  - src/artifact-contract.js
  - src/artifact-registry.js
  - src/artifact-subjects.js
  - src/build-contract.js
  - src/builder-package.js
  - src/cli.js
  - src/javascript-static-analysis.js
  - src/openclaw-credential-handoff.js
  - src/openclaw-install-approval.js
  - src/openclaw-install-plan.js
  - src/openclaw-install-receipt.js
  - src/openclaw-install-transaction.js
  - src/openclaw-probe-contract.js
  - src/openclaw-probe.js
  - src/openclaw-target-admission.js
  - src/package-archive.js
  - src/package-carriers.js
  - src/package-contract.js
  - src/package-inspect.js
  - src/package-produce.js
  - src/targets/openclaw-package.js
  - test/artifact-admission.test.js
  - test/artifact-contract.test.js
  - test/artifact-subjects.test.js
  - test/artifact-surface-coverage.test.js
  - test/builder-packed-install.test.js
  - test/cli.test.js
  - test/helpers/io-surface-inventory.js
  - test/openclaw-build-contract.test.js
  - test/openclaw-install-approval.test.js
  - test/openclaw-install-plan.test.js
  - test/openclaw-install-transaction.test.js
  - test/openclaw-package.test.js
  - test/openclaw-probe.test.js
  - test/openclaw-target-admission.test.js
  - test/package-carriers.test.js
  - test/package-contract.test.js
  - test/package-determinism.test.js
  - test/package-inspect.test.js
  - test/package-produce.test.js
  - test/phase4-contracts.test.js
  - test/runtime-compatibility-seams.test.js
  - test/stage-contracts.test.js
findings:
  critical: 10
  warning: 3
  info: 0
  total: 13
status: issues
---

# Phase 04: Code Review Report

**Reviewed:** 2026-07-30T05:12:58Z
**Depth:** standard
**Files Reviewed:** 51
**Status:** issues

## Summary

The submitted implementation is not safe to ship. The public apply path does
not perform the documented fresh probe, accepts self-authenticating target and
probe evidence, does not consume approval nonces, and can follow target-parent
symlinks outside the approved root. Recovery can delete a file after it has
been modified or replaced, despite the release record claiming that exact
owner-marker, identity, and digest facts are re-observed.

The credential handoff and receipt defects were reproduced without live
OpenClaw. A three-field forged decision authorized an arbitrary
`openclaw plugins install evil` invocation. Separately,
`validateOpenClawInstallReceipt` returned `{ok:true}` for a `status:"complete"`
receipt whose only operation was `preserved`.

The user-supplied full gate result (884 pass, 0 fail, 1 skip) does not cover
these adversarial transitions. Several tests instead encode the vulnerable
behavior as success, particularly the incomplete credential decision and the
hand-constructed probe used by the CLI apply test.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01 [BLOCKER]: Public apply silently reuses the approved probe instead of re-probing

**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:139-147`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:588-603`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:979-981`
- `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1265-1291`

**Issue:** `openclaw-install-apply` does not pass an adapter. The option
normalizer therefore sets `adapters` to `null`, and `reprobe(null, basis)`
returns `basis.probe` unchanged. `sameProbeBasis` consequently compares the
approved fingerprint to itself. Target executable bytes, target revision,
configuration, ownership, and conflicts can change after preview/approval
without a fresh target probe detecting the drift. This directly contradicts
the operator contract in `docs/MVP_RUNBOOK.md:239-244` and
`docs/STAGE_CONTRACTS.md:92-98`.

**Fix:** Make fresh re-probing a required production dependency, not an
optional adapter. The public apply route must re-run the exact target/carrier,
archive, CLI, config, and conflict observations immediately before journal
creation. Remove both fallback returns from `reprobe`; injected adapters should
remain test-only and must still return a fully validated probe. Compare the
complete normalized probe basis and retained target-member identities, not only
one caller-computable fingerprint string. Add a CLI test that changes target
bytes and config after approval and asserts zero journal/effects.

### CR-02 [BLOCKER]: Target/carrier and probe authorities are self-authenticating and substitutable

**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:82-97`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:328-341`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:577-586`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-probe-contract.js:21-70`
- `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1149-1159`

**Issue:** Apply loads the target/carrier admission with no validator; any
plain object containing the expected schema version passes. The only later
carrier check is conditional on `carrier.target?.id`, so omitting `target`
bypasses it. Probe validation checks a handful of nested flags and hashes the
same caller-provided nested data; it neither closes the nested schema nor
requires `status` and `compatibility.status` to be `compatible`. Preview also
never checks compatibility status. An external SHA-256 proves only the forged
bytes the caller just supplied, not Phase 3 provenance or a genuine target
observation. `test/openclaw-install-transaction.test.js:348-428` demonstrates
the problem by hand-constructing the probe accepted by public apply.

**Fix:** Reuse the canonical full validators instead of parallel shallow
validators. Re-admit the target/carrier artifact with its exact blueprint,
build-contract, plan-approval, and target-descriptor companion admissions.
Require a closed probe schema, exact archive/carrier/descriptor bindings,
`status === "compatible"`, matching compatibility status, and a freshly
observed target. Reject a carrier with missing nested authority fields. Add
substitution tests for an empty carrier, handcrafted probe, incompatible probe,
and mismatched descriptor/recipe/source chain.

### CR-03 [BLOCKER]: Managed target paths can escape `targetRoot` through symlinked or swapped parents

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:605-627,645-682,914-925`

**Issue:** `resolveManagedPath` provides lexical containment only.
`observeOperations` performs `lstat` on just the final parent, does not require
that parent to be a non-symlink directory, and does not retain or validate
intermediate ancestors. `applyOperation` trusts the earlier observation and
later calls path-based `writeFile(..., {flag:"wx"})`, which follows a symlinked
parent. A parent can also be swapped between observation and the write. The
same unresolved root is used for the private journal. This permits writes
outside the isolated project root and defeats D-42 ownership containment.
The symlink test at `test/openclaw-install-transaction.test.js:564-571` covers
only the archive input, not target-root or parent traversal.

**Fix:** Open and retain the target root and every ancestor directory with
no-follow semantics, reject symlinks/non-directories, and bind device/inode
identities through the effect. Create files relative to a retained directory
descriptor (`openat`-style helper or an equivalent native safe-filesystem
primitive), then post-observe the created descriptor. Do not use a second
pathname resolution for the effect. Cover a symlinked root, every intermediate
ancestor, a final-parent symlink, and a directory-swap race.

### CR-04 [BLOCKER]: Automatic recovery trusts fabricated cached predicates and can delete changed user data

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:250-303,690-720`

**Issue:** Apply never creates or reads an owner-marker file. It simply sets
`ownerMarkerDigestMatches`, `retainedIdentityMatches`, and
`currentDigestMatchesDesired` to `true` after one post-write read and marks the
object in a `WeakSet`. Internal recovery copies those booleans into a new
`WeakSet` member, then the recovery function skips all current filesystem
checks and unlinks the path. If a fault, user, or attacker changes or replaces
the file after the write but before recovery, AgentMo deletes the changed file.
Even the public branch has a read/lstat-to-unlink race. This is the opposite of
the four-fact recovery guarantee documented in
`release/2026.07.30.md:55-57`.

**Fix:** Remove `AUTHENTIC_RECOVERY_ASSETS` and never use cached booleans as
delete authority. Create and retain an actual attempt owner marker, file
descriptor, and parent descriptor. Immediately before cleanup, re-read the
marker digest and target digest through retained no-follow handles, compare
device/inode identities, and unlink relative to the retained parent only if all
facts still hold atomically. Preserve on any ambiguity. Add fault-injection
tests that replace, rewrite, hard-link, and parent-swap the created file after
`after-operation` and before recovery.

### CR-05 [BLOCKER]: Approval nonces are never durably consumed, so all three authority families are replayable

**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-approval.js:484-528`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:112-132`
- `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1235-1238`

**Issue:** Decision validation rejects a nonce only if it appears in a
caller-provided in-memory array. Builders always use `usedNonces: []`; apply
hardcodes another fresh empty array on every invocation; and the approval CLI
accepts its list from the request being approved. No atomic ledger or use
marker is written. The same ordinary approval, sensitive decision, and
conflict-set approval can therefore be replayed until expiration.

**Fix:** Add a durable append-only consumption ledger (or atomic per-decision
use marker) keyed by authority digest, `useNonce`, target, plan, and lifecycle.
Atomically reserve every nonce before the first target effect, reject any
existing reservation, and bind the consumed records into both complete and
incomplete receipts. A retry after an interrupted reservation must recover
from the recorded attempt rather than replay the decision. Add same-process
and fresh-process replay tests for every authority family.

### CR-06 [BLOCKER]: Credential handoff accepts forged decisions and arbitrary OpenClaw subcommands

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-credential-handoff.js:64-124`

**Issue:** `runApprovedOpenClawCredentialHandoff` checks only three decision
facts: schema string, `"approve"`, and action equality. It does not invoke
`validateOpenClawSensitiveActionDecision`, bind a plan/archive/target, enforce
issue/expiry times, or consume a nonce. The “official route” filter requires
only executable `openclaw`, forbids two textual MCP forms, and rejects
credential-looking `key=value` arguments. Arbitrary commands such as
`openclaw plugins install evil`, config mutation, or agent execution pass.
`test/openclaw-install-transaction.test.js:273-285` currently asserts that an
invalid three-field decision succeeds. A value-blind result does not make the
effect safe.

**Fix:** Require an exact admitted plan, action, full decision artifact, target
admission, current time, and durable nonce ledger. Call the canonical sensitive
decision validator before any runner. Replace the blacklist with a fixed
allowlist and exact argv grammar for supported credential/auth commands, and
bind the executable path/digest to the admitted target. Remove the test that
blesses the truncated decision; add denial cases for plugin, config, agent,
schedule, MCP, expired, stale-plan, and replayed decisions.

### CR-07 [BLOCKER]: A receipt with preserved work validates as `complete`

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-receipt.js:33-61`

**Issue:** Complete-status validation rejects only `failed` outcomes and
non-empty recovery needs. It does not reject a `preserved` outcome or non-empty
`preservedAssets`. A crafted receipt can therefore state `status:"complete"`
while no operation was applied, then pass durable artifact admission and serve
as the predecessor for upgrade, rollback, or uninstall. This was reproduced
by mutating the registered minimal receipt: the validator returned
`{"ok":true,"errors":[]}` for one preserved operation and one preserved asset.

**Fix:** Define complete as an exact invariant: every operation outcome is
`applied`, every applied observation matches desired content and retained
parent identity, `preservedAssets` is empty, `remainingRecoveryNeeds` is empty,
and all approved external actions succeeded. Define incomplete as the
complement and require a reason/recovery item for every non-applied operation.
Add adversarial tests for preserved-only, mixed applied/preserved, non-empty
preserved assets, and contradictory status fields.

### CR-08 [BLOCKER]: Receipts discard the plan, approvals, nonce consumption, and sensitive-action results

**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-receipt.js:18-30`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:182-205`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:758-852`

**Issue:** Transaction execution collects bounded sensitive-action results and
passes `externalResults` to `buildReceipt`, but `buildReceipt` does not
destructure or serialize them. The receipt schema also omits the install-plan
digest, ordinary/sensitive/conflict approval digests, consumed nonces, and
external dependency/action results. Two executions with identical file
operations but different plans or sensitive authorities can produce the same
receipt, and a complete receipt cannot prove that every approved sensitive
action ran successfully. Downstream lifecycle admission therefore relies on
evidence that does not bind the authority/effect set it purports to summarize.

**Fix:** Extend the receipt with the exact external and internal install-plan
digests, every approval digest and consumed nonce, attempt/journal identity,
and a sorted one-to-one list of bounded action results containing action digest,
exit/timed-out status, and no raw output. Validate exact cardinality against the
plan and make complete status conditional on every action succeeding. Add
mutation tests that remove, duplicate, reorder, or substitute an action result
or approval.

### CR-09 [BLOCKER]: Probe execution races verified bytes and runs with the repository as its working directory

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-probe.js:84-118,286-318,332-338`

**Issue:** The probe reads and hashes each target member, closes the retained
handle, stores an absolute pathname, and later spawns that pathname three
times. There is no identity/digest recheck immediately before each spawn or
after the child. A pathname swap can therefore execute substituted JavaScript
with AgentMo's process privileges. In addition, `spawnBounded` omits `cwd`, so
the allegedly isolated child inherits the repository working directory. A
normal or substituted CLI can inspect project files such as `.env` even though
HOME and selected environment variables are synthetic.

**Fix:** Execute immutable verified bytes: copy from the retained no-follow
handle into a private mode-0700 synthetic executable, fsync it, verify its
digest/identity, and execute only that copy. Set `cwd` to an already-created
private synthetic workspace and revalidate the admitted source target after
the child exits. Where the threat model requires it, add process/network
sandboxing rather than treating environment replacement as isolation. Add a
swap-before-spawn, swap-between-commands, inherited-cwd, and self-modification
test.

### CR-10 [BLOCKER]: Error cleanup removes whatever currently occupies an output pathname

**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/package-produce.js:192-241`
- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-target-admission.js:289-303`

**Issue:** Once package production renames the staged directory, failure
cleanup recursively removes `outputRoot` and removes `archivePath` using only
boolean flags. If either pathname is replaced before a later archive
verification failure, cleanup deletes the replacement, including an unrelated
directory tree. The target/carrier admission writer has the same defect on its
partial-output path: unlike the plan/approval/receipt writers, it never records
the created inode before unlinking. These are data-loss TOCTOU bugs.

**Fix:** Retain and record the created file/directory and parent identities.
Cleanup must remove only the exact object created by the attempt, relative to a
retained parent, after an immediate identity check. Never recursively delete a
post-publication pathname whose identity can no longer be proven. Align the
target-admission writer with the inode-bound cleanup used by the newer writers.
Add injected post-rename/post-open replacement tests and assert that the
replacement survives.

## Warnings

### WR-01 [WARNING]: Advertised lifecycle and sensitive-action routes are not executable

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-transaction.js:163-194,645-675`

**Issue:** `applyOperation` implements only creation by `write`; every `patch`
or `remove` operation is preserved as unsupported. The public CLI nevertheless
advertises upgrade, rollback, and uninstall, whose meaningful operations
require patch/remove behavior. Likewise, a public plan containing a sensitive
action always fails after file effects because the CLI has no
`runSensitiveAction` adapter. The resulting incomplete receipt is safe relative
to blind mutation, but the exposed routes cannot deliver their advertised
function.

**Fix:** Either implement ownership-safe patch/remove and a fixed official
sensitive-action runner before advertising those routes, or reject unsupported
operations during preview and remove the routes from public help/contracts
until Phase 5. Add end-to-end fixture tests that assert the exact expected
target transition, not merely grammar or incomplete preservation.

### WR-02 [WARNING]: Absent-genesis authority marks caller claims as verified observation

**Files:**

- `/Users/alexzhu/Lenovo/AgentMo/src/openclaw-install-plan.js:75-103`
- `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1117-1130`

**Issue:** The genesis CLI reads a caller-created request with an always-true
validator. `buildOpenClawAbsentGenesisAuthority` performs no filesystem
observation and unconditionally writes `verifiedAbsent: true`. The caller also
supplies `checkedPaths`, timestamp, and observation digest. Although apply
later preserves a conflicting file, the durable genesis artifact itself is
self-certifying and can mislead plan/review evidence.

**Fix:** Have the genesis command derive checked paths from the admitted archive
and target, observe them no-follow under a retained root, compute the absence
digest internally, and publish only those measured facts. The request should
contain intent/target identity only, never the purported observation result.

### WR-03 [WARNING]: Valid nested recipe paths are flattened and can collide during projection

**File:** `/Users/alexzhu/Lenovo/AgentMo/src/targets/openclaw-package.js:97-102`

**Issue:** Recipe validation permits portable paths below
`openclaw/plugin/`, but projection discards the directory portion with
`path.posix.basename`. Two otherwise valid recipe members such as
`openclaw/plugin/a/index.js` and `openclaw/plugin/b/index.js` collapse to one
destination and make package production fail. A single nested member is also
installed at a different path than its approved recipe declares.

**Fix:** Preserve the relative suffix below `openclaw/plugin/` and validate the
resulting destination as a portable path, or explicitly restrict the recipe
contract to direct children and reject nested paths during recipe admission.
Add nested-path and basename-collision tests.

---

_Reviewed: 2026-07-30T05:12:58Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
