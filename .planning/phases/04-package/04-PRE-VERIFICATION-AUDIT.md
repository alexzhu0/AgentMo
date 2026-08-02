# NONCANONICAL PRE-VERIFICATION AUDIT

This report is **non-self-certifying**. It is advisory input to the
execute-phase post gate only; it cannot prove that Phase 4 passed, cannot replace
the canonical code review or verification, and does not authorize any phase,
roadmap, requirement, release, Birth, Delivery, runtime, domain, or production
status change.

**Audit date:** 2026-07-31
**Depth:** deep/security, source and call-chain review
**Result:** blockers remain; Plan 04-19 Task 3's no-open-Critical/Warning done
condition is not met
**Findings:** Critical 8, Warning 2, Suggestion 0

## Scope and evidence boundary

The review traced the current dirty worktree implementation without modifying
source files. It covered the six reviewed root gaps, `CR-01..10`,
`WR-01..03`, `PACK-01..05`, the Plan 04-13 retained-dirfd helper and Plan
04-14 durable authority designs, the high/critical ASVS L1 threat claims in
Plans 04-12 through 04-19, the packed distribution inventory, and the latest
test-lane changes.

No `.env` file, secret value, raw provider payload, real HOME/OpenClaw state,
network service, or sibling repository was read or exercised. The previously
recorded final `npm run check` result was inspected but not rerun. A green test
gate is regression evidence, not proof that the security invariants below hold.

## Executive assessment

The implementation materially improves the original reviewed state: input
companions are re-admitted, public apply performs a fresh probe, target writes
use a retained-root native helper, the official credential argv grammar is
closed, absent genesis is observed, four lifecycle fixtures exist, public
package artifacts use atomic no-replace publication, and the packed runtime
inventory is explicit.

However, the current implementation still permits:

- replay of the same approval set by selecting a fresh authority-state root;
- acceptance of a forged “complete” receipt whose post-state and external
  results were never independently authenticated;
- pathname/hard-link redirection during an official config mutation;
- target effects followed by failure to construct either a complete or
  incomplete receipt when a nonce is reused across authority families;
- publication of a package directory whose nested bytes no longer match the
  already-built archive/manifest;
- deletion of replacement objects during pathname-based error cleanup;
- official-action descendants continuing after the parent was timed out; and
- credential state being written to an untracked private temp root while exit
  zero is reported as credential presence.

These are correctness, security, data-loss, or evidence-integrity defects. The
canonical post gate should keep Phase 4 in `gaps_found`/Needs Review until they
are fixed and independently re-reviewed.

## Coverage matrix

### Root gaps 1..6

| Set | Advisory status | Evidence and conclusion |
|---|---|---|
| Root gap 1 — authentic fresh probe and execution window | PARTIAL | `src/openclaw-install-transaction.js:193-220` performs a real companion-backed reprobe before authority reservation. Private executable/cwd handling is present. Official-action mutation and descendant windows remain open (C-03, C-07). |
| Root gap 2 — durable authority consumption and credential command confusion | FAIL | Per-family markers and closed credential grammar exist, but caller-selected fresh roots replay the same approvals and cross-family nonce semantics are inconsistent (C-01, C-04). |
| Root gap 3 — retained-dirfd safe mutation/helper supply chain | PARTIAL | The native target mutation kernel is retained-dirfd/no-follow and no-replace. The official config runner bypasses it with an absolute pathname, and helper pair publication can leave an orphan (C-03, W-01). |
| Root gap 4 — strict non-self-certifying receipt | FAIL | Shape/cardinality checks are strict, but post-state, external results, and consumed-marker facts remain assertions in caller-provided receipt bytes (C-02). |
| Root gap 5 — observed genesis and executable lifecycle | PARTIAL | Genesis derives and re-observes paths, and all four lifecycle fixtures exist. The credential route writes isolated temp state rather than a proven intended credential store and can still yield a complete ledger claim (C-08). |
| Root gap 6 — temp-complete publication, recovery, nested projection, packed closure | FAIL | Native top-level no-replace and nested suffix preservation exist, but directory member bytes are not re-closed at publication and several writers retain pathname cleanup races (C-05, C-06, W-02). |

### Historical review findings

| Set | Advisory status | Re-check |
|---|---|---|
| CR-01 | CLOSED for the original fallback | Public apply calls production reprobe directly; no approved-probe adapter fallback was found. |
| CR-02 | CLOSED for input companions | Probe, carrier, target descriptor, blueprint, build contract, plan approval, and archive inputs use explicit file plus external digest admissions. This does not close output receipt authenticity (C-02). |
| CR-03 | OPEN in an official-action branch | Managed safe-fs operations are retained-dirfd, but official config patching hands a pathname to a child after closing the observed fd (C-03). |
| CR-04 | PARTIAL | Cached recovery predicates and target unlink were removed, but pathname cleanup persists in probe and authority writers (C-06). |
| CR-05 | OPEN | Markers are durable only inside the root selected by the caller for that invocation; changing the root bypasses replay detection (C-01). |
| CR-06 | CLOSED for grammar | Only exact `secrets apply --from … [--dry-run]` and `models auth login --provider … [--method …] [--profile …]` forms are admitted. No plugin/MCP/config/schedule confusion path was found in that validator. |
| CR-07 | OPEN | Completion depends on receipt booleans/digests that admission does not recompute from post-effect authorities (C-02). |
| CR-08 | OPEN | The fields are now present, but presence is not authenticity: result/marker/post-state claims have no independent post-effect companion (C-02). |
| CR-09 | PARTIAL | Probe executes verified private bytes from private cwd/env, but its recursive pathname cleanup is raceable and process-tree containment remains incomplete (C-06, C-07). |
| CR-10 | OPEN | The four Plan 04-17 publishers preserve public objects, but approval/plan/receipt writers and probe cleanup still delete reopened pathnames after a separate identity check (C-06). |
| WR-01 | PARTIAL | Four lifecycle flows and official runners exist, but the credential runner cannot prove intended durable credential state (C-08). |
| WR-02 | CLOSED | `buildOpenClawAbsentGenesisAuthority` derives paths and observes them through the retained safe-fs session; verification re-observes the same set. |
| WR-03 | CLOSED | `src/targets/openclaw-package.js:97-108` retains the full approved suffix and collision-checks the projected path. |

### Package requirements

| Set | Advisory status | Re-check |
|---|---|---|
| PACK-01 | SATISFIED in reviewed schema path | Manifest identity, bindings, compatibility, inventory, ownership, permissions, evidence, boundaries, and risks are closed and validated. |
| PACK-02 | SATISFIED in reviewed projection path | The offline candidate exposes the declared workspace/skill/tool/hook/memory/eval/mapping surfaces without adding a runtime activation claim. |
| PACK-03 | OPEN | Archive construction is deterministic, but the separately published canonical directory can be mutated after archive build without nested revalidation (C-05). |
| PACK-04 | SATISFIED in reviewed carrier path | Workspace/skill projection is default; native plugin mapping requires the approved recipe; MCP remains false. |
| PACK-05 | SATISFIED for package/inspection bytes | Exact inventory and persistability checks exclude credential values, `.env`, raw transcripts, provider payloads, authority state, compiled helpers, and npm install hooks from the tarball. |

## Critical findings

### C-01 — Caller-selected authority roots make one-use approvals replayable

**Severity:** Critical
**Affected paths:** `src/openclaw-install-transaction.js:238-257`,
`src/openclaw-authority-consumption.js:45-79`,
`src/openclaw-authority-consumption.js:125-189`

**Evidence:** Apply accepts `authorityStateRoot` as an invocation option,
prepares that arbitrary absolute `0700` directory, and opens the marker session
there. Marker paths are only `{family}/{sha256(useNonce)}.json`; neither the
approval artifacts, plan, target, nor any repository-owned authority locator
binds which root is authoritative. Replaying the identical approvals and plan
with a newly created secure root makes every marker absent, so every reservation
is reported `created`. Current replay tests reuse one root and therefore do not
exercise this bypass.

**Impact:** Ordinary, sensitive, and conflict approvals that are specified as
one-use can authorize multiple install attempts and multiple external actions.
This leaves CR-05, root gap 2, and ASVS threat `T-04-G14-01` open.

**Required follow-up:** Derive or authenticate one canonical authority ledger
location from a stable installation/target authority that the caller cannot
change per attempt. Bind that location into preview/approval artifacts and
receipt companions. Add a fresh-process regression that reuses the same
approvals with a different caller-supplied root and proves zero journal, target,
or external effects.

### C-02 — Receipt admission still self-certifies post-state and action results

**Severity:** Critical
**Affected paths:** `src/openclaw-install-receipt.js:471-536`,
`src/openclaw-install-receipt.js:595-611`,
`src/openclaw-install-receipt.js:614-740`

**Evidence:** `validCompanionClosure` authenticates plan/approval/probe/target
descriptor sources and compares the receipt's *before* observations to the
private journal. For managed *after* state it only validates the receipt's
`afterDigest`, identity, disposition, and `postStateMatches` shapes. For
external actions it checks action ID/digest and approval source, but not the
claimed `resultDigest` or the action outcome against an independent artifact.
For nonces it accepts `consumed: true` copied into receipt markers and never
reopens the durable marker ledger. The completion theorem then trusts those
same fields.

A caller with authentic pre-effect companions can construct new receipt bytes,
claim arbitrary successful post-state/result digests and consumed markers,
recompute the receipt's external SHA-256, and pass admission. An external digest
selected alongside the file proves byte identity, not producer authenticity.

**Impact:** A forged complete receipt can become predecessor authority for
upgrade/rollback/uninstall even though the represented mutation or sensitive
action did not occur. CR-07, CR-08, root gap 4, `T-04-G16-01`,
`T-04-G16-02`, and historical-receipt authenticity remain open.

**Required follow-up:** Introduce independently admitted post-effect companions:
an identity-bound post-state journal produced through retained sessions, the
canonical marker ledger/root authority, and closed official-action result
artifacts whose producer and result digest are authenticated. Recompute the
completion theorem from those companions during every receipt admission,
including recursive predecessor admission. Add a test that forges all current
receipt success fields, recomputes every internal/external digest, and still
must be rejected.

### C-03 — Official config patching reintroduces pathname and hard-link races

**Severity:** Critical
**Affected paths:** `src/openclaw-official-action-runner.js:153-215`,
`src/openclaw-official-action-runner.js:273-297`

**Evidence:** `inspectConfig` opens with `O_NOFOLLOW`, checks `nlink === 1`, reads
and compares the current pathname, then closes the handle. The dry-run and
actual child invocations receive the absolute pathname through
`OPENCLAW_CONFIG_PATH`. There is no retained parent dirfd, expected inode, or
atomic compare-and-replace operation coupled to the child's write. An attacker
with write access to the parent can replace the path after inspection or after
dry-run, including with a hard link to another regular file, let the official
child mutate that object, and replace the expected object before the next
inspection. Post-observation can detect some final states but cannot undo or
prove absence of an external write.

**Impact:** An approved config patch can mutate bytes outside the approved
target, violating CR-03, OCLW-04, root gap 3, and critical threat
`T-04-G15-02`.

**Required follow-up:** Do not let the official child mutate the approved final
pathname directly. Run the official operation against an identity-bound private
candidate, validate the complete result, then publish it with a native
retained-dirfd compare-and-replace primitive that requires the exact approved
base inode/digest and preserves on any ambiguity. Add deterministic races at
the pre-dry-run, dry-run/actual, and actual/post-observation boundaries,
including hard-link and ancestor replacement.

### C-04 — Cross-family nonce reuse can apply effects and then prevent every receipt

**Severity:** Critical
**Affected paths:** `src/openclaw-install-approval.js:528-567`,
`src/openclaw-authority-consumption.js:125-189`,
`src/openclaw-install-transaction.js:267-447`,
`src/openclaw-install-receipt.js:408-468`

**Evidence:** Decision validation requires only a nonempty `useNonce`; it does
not reject the same nonce in ordinary, sensitive, and conflict decisions.
Reservation keys include the family directory, so those equal nonces are all
created successfully. The private journal is serialized and published without
calling `validateOpenClawInstallJournal`, and target/external effects then run.
Only receipt construction enforces global uniqueness of `nonceDigest` across
all families. `buildReceipt` consequently throws after effects. The catch path
calls the same receipt builder with the same marker list, so it cannot publish
an incomplete receipt either.

**Impact:** A structurally accepted approval set can leave durable markers,
journal, managed/external effects, and no admissible recovery receipt. This is a
fail-open side-effect/fail-closed-evidence split and a data/recovery risk.

**Required follow-up:** Define nonce uniqueness explicitly. If uniqueness is
global, reject the complete approval set before marker creation. If the Plan
04-14 contract is per-family/per-nonce, validate uniqueness on
`family + nonceDigest` consistently in reservation, journal, receipt, and
recovery. Validate the complete journal/receipt basis before the first effect,
and add equal-nonce cross-family tests for fresh, crash, race, and resume paths.

### C-05 — Package directory publication authenticates only the top inode

**Severity:** Critical
**Affected paths:** `src/package-produce.js:203-274`,
`src/package-produce.js:790-810`,
`native/openclaw-fs-kernel.c:483-560`

**Evidence:** Package members and manifest are written, the archive is built
from the stage, and then the stage directory is renamed. The native publisher
checks the source directory's top-level device/inode/type/owner/mode, but not a
digest or immutable closure of nested members. After `buildPackageArchive`
returns, a same-uid concurrent process can modify an existing staged member
without changing the top directory inode. Final success re-observes only the
published directory identity. The returned canonical package directory may
therefore disagree with its manifest and already-built archive while
`package-produce` returns success.

**Impact:** PACK-03 deterministic package identity and D-42 directory/archive
equivalence can be violated. Consumers of the directory and archive can receive
different bytes under one successful production result.

**Required follow-up:** Make the staged tree immutable to concurrent writers or
recompute and compare the exact manifest/member closure immediately through a
retained tree authority before and after publication. Success must bind the
published canonical directory to the same inventory digest used for the
archive, not just the top inode. Add a hook-driven test that mutates a nested
member after archive build but before directory rename.

### C-06 — Error cleanup can delete replacement objects

**Severity:** Critical
**Affected paths:** `src/openclaw-probe.js:320-324`,
`src/openclaw-install-plan.js:356-385`,
`src/openclaw-install-approval.js:496-525`,
`src/openclaw-install-receipt.js:912-920`

**Evidence:** Probe cleanup recursively removes `privateRoot` by pathname.
Plan, approval, and receipt writers separately `lstat` a failed output, compare
its inode, and then call pathname `unlink`. The identity check and removal are
not one retained-dirfd kernel operation. A concurrent same-uid process can
rename the checked object and place another object at that name between the
check and deletion; recursive probe cleanup can remove an entire replacement
directory tree.

**Impact:** Error handling can delete unrelated user data, reopening CR-10 and
the cleanup aspect of CR-04 despite the safer Plan 04-17 public publishers.

**Required follow-up:** Remove automatic pathname cleanup, or perform
identity-checked removal in one retained parent-dirfd native operation with no
reopen window. Unknown/replaced objects must be preserved and reported. Add
deterministic swap-after-check tests for each writer and for recursive private
root cleanup.

### C-07 — Timeout kills only the direct child, not the official action process tree

**Severity:** Critical
**Affected paths:** `src/openclaw-official-action-runner.js:353-384`

**Evidence:** The timeout and output cap call `child.kill("SIGKILL")` on the
direct Node process. The child is not placed in a separately managed process
group and descendants are neither enumerated nor awaited. An OpenClaw action
can spawn a helper that inherits `OPENCLAW_CONFIG_PATH`/state environment,
outlives its killed parent, and mutates state after the runner has returned or
after post-observation. The Promise also has no explicit `error` listener.

**Impact:** Timeout/cancellation is not fail-closed. Later mutations can escape
the approved attempt and invalidate receipt post-state.

**Required follow-up:** Supervise the whole process tree using a platform-tested
process group or a small native supervisor, terminate and reap all descendants,
and require a bounded quiescence/post-state check before recording any result.
Handle spawn errors explicitly. Add a fixture whose parent exits or times out
while a grandchild attempts a delayed mutation.

### C-08 — Credential “success” targets untracked temp state and can retain secrets

**Severity:** Critical
**Affected paths:** `src/openclaw-official-action-runner.js:69-93`,
`src/openclaw-credential-handoff.js:119-156`,
`src/openclaw-install-transaction.js:317-389`

**Evidence:** The credential action runs with both `HOME` and
`OPENCLAW_STATE_DIR` set to the private executable-copy directory, not an
approved durable OpenClaw credential store. A relative `secrets apply --from`
input is not copied into that cwd. `models auth login` may write credential
state into the temp directory, but the transaction never cleans, itemizes, or
authenticates that directory. The result sets `credentialPresent` solely from
exit code zero and can feed a complete receipt without re-observing any intended
credential state.

**Impact:** Real credential setup can be nonfunctional while evidence reports
success; if an official login does write a token, secret-bearing temp state can
remain indefinitely outside the evidence/recovery ledger. This leaves WR-01,
root gap 5, `T-04-G14-05`, and `T-04-G15-05` open.

**Required follow-up:** Define and approve the exact official credential-state
destination and source-reference semantics. Let only the verified official
route cross that boundary, re-observe value-blind presence through an official
status interface, and never infer presence from exit code alone. Use
identity-safe cleanup or an explicitly admitted durable state artifact so no
secret-bearing temp directory becomes an untracked orphan. Add real-behavior
fixture tests for both admitted grammars, not an exit-zero stub.

## Warnings

### W-01 — Helper/receipt publication is not one recoverable pair

**Severity:** Warning
**Affected path:** `src/openclaw-safe-fs.js:79-200`

**Evidence:** The helper binary is published first to `binaryOut`; receipt
creation and admission happen afterward, potentially in another parent
directory. If receipt creation, sync, or final admission fails, the already
published binary remains but the catch path returns only a generic error. The
private build root is intentionally preserved, yet its identity/path is not
included in failure evidence. No source file is overwritten, and apply will
reject a missing receipt, but operators cannot distinguish or recover all
orphan states from the error.

**Required follow-up:** Publish the binary/receipt as one admitted directory or
return a closed recovery object listing every created/preserved identity and
digest on all failures. Bind and revalidate both output parents, and add crash
tests after binary publication, during receipt write, and after receipt sync.

### W-02 — Failed private-temp observation silently erases recovery evidence

**Severity:** Warning
**Affected path:** `src/package-produce.js:813-854`

**Evidence:** `preservedPrivateTempEvidence` catches any observation failure and
`continue`s, omitting that known candidate entirely. The returned
`preservedPrivateTemps` list can therefore look complete while an
unobservable/replaced/unknown stage or archive temp still exists.

**Required follow-up:** Emit one evidence row for every known temp candidate.
When observation fails, retain its expected path/type/identity/digest with an
`unknown` disposition and force recovery-required. Test missing, replaced,
permission-denied, and malformed temp observations.

## Plan 04-13 and 04-14 checker re-audit

| Contract | Result | Notes |
|---|---|---|
| 04-13 retained-dirfd helper build/admission | PARTIAL | Fixed packed source, `/usr/bin/cc`, argv, closed environment, source/compiler/binary identities, and external receipt digest are re-admitted (`src/openclaw-safe-fs.js:202-278`). Pair publication/recovery remains incomplete (W-01). |
| 04-13 source/receipt/external digest closure | SATISFIED for helper admission | Current source/compiler/helper bytes and file identities are compared to the closed receipt; apply does not auto-build or PATH-resolve the helper. |
| 04-13 Darwin/Linux fail-closed no-replace | SATISFIED in native publisher | Linux uses `renameat2(..., RENAME_NOREPLACE)`, Darwin uses `renameatx_np(..., RENAME_EXCL)`, and unsupported platforms return `ENOTSUP`; no plain rename fallback was found. |
| 04-13 publication/recovery | PARTIAL | Native target/publication operations preserve ambiguity, but package nested closure, generic writer cleanup, and private-temp itemization remain open (C-05, C-06, W-02). |
| 04-14 per-family/per-nonce durable marker crash/race/resume | FAIL | O_EXCL/fsync and exact-resume logic exist, but root selection permits replay and cross-family nonce rules diverge between reservation and receipt (C-01, C-04). |
| 04-14 official credential grammar | SATISFIED for argv rejection | Exact secrets/models forms are closed and extra/reordered/plugin/MCP/config/schedule routes are rejected. The grammar does not prove correct credential-state effects (C-08). |

## ASVS L1 high/critical mitigation re-audit

| Threat group | Advisory result | Blocking observations |
|---|---|---|
| G12 fresh provenance/executable/cwd/apply reprobe | PARTIAL | Input provenance and private execution are materially closed; process-tree lifetime and cleanup remain open (C-06, C-07). |
| G13 path/recovery/helper substitution | PARTIAL | Retained target mutation and helper admission are strong; official config bypass and helper orphan recovery remain (C-03, W-01). |
| G14 replay/marker/credential argv | FAIL | Closed argv passes; canonical ledger location and nonce consistency do not (C-01, C-04). |
| G15 genesis/config/lifecycle/official actions | FAIL | Genesis and fixtures pass; critical config pathname race and credential-state semantics remain (C-03, C-08). |
| G16 completion/result authenticity | FAIL | Strict shape/cardinality exists but result and post-state facts remain self-asserted (C-02). |
| G17 cleanup/publication/nested projection | FAIL | Nested suffix and top-level atomic no-replace pass; nested package closure and pathname cleanup remain (C-05, C-06, W-02). |
| G18 packed inventory/build distribution | SATISFIED in reviewed scope | Exact runtime inventory includes native source/facade, excludes compiled helper and install hooks, and the extracted public CLI journey is present. |
| G19 phase evidence/canonical artifact boundary | SATISFIED by this audit | This file is visibly noncanonical/non-self-certifying, contains no raw secrets/logs, and no canonical or status artifact was written by the reviewer. |

## Test-lane and distribution audit

| Item | Result | Evidence |
|---|---|---|
| Main lane composition | SOUND | `package.json:118-121` runs syntax checks, then main, packed-hook-chain, and immutable-successor with `&&`; a green aggregate requires all three. |
| Packed-hook-chain skip/lane | SOUND | `test/builder-packed-install.test.js:3591-3595` skips only when `AGENTMO_TEST_LANE === "main"`; the exact-name isolated command executes that scenario. |
| Immutable-successor skip/lane | SOUND | `test/codex-builder-behavior.test.js:1087-1091` uses the same main-only skip and has its own exact-name isolated command. |
| Coverage accounting | NOT REDUCED by lane split | Each resource-sensitive scenario executes once after the main suite. Nonmatching tests enumerated by `--test-name-pattern` may be reported as skips by Node, but the release correctly describes each isolated lane as one exact executed scenario, not as extra aggregate coverage. |
| Latest recorded gate | GREEN, bounded historical evidence | `release/2026.07.30.md:360-368` records final main 935 pass/0 fail/3 skip plus packed 1/1 and immutable 1/1, followed by pack/diff exit zero. This audit did not rerun the expensive full gate. |
| Test harness deadline | TEST ONLY | `test/builder-packed-install.test.js:3808-3813` sets 35 seconds on the test helper. |
| Production deadline | UNCHANGED | `plugin/hooks/agentmo-hook.js:25` remains 30 seconds. |
| Packed Phase 4 inventory | CLOSED in reviewed lists | `test/builder-packed-install.test.js:36-55` and `src/builder-package.js:989-1097` include the Phase 4 modules and native C source. Negative inventory tests cover missing/unlisted/symlinked/duplicate/remapped members. |
| Nested recipe projection | SOUND | Full recipe-relative suffixes are retained and collision checked; the packed regression includes distinct nested same-basename paths. |

The lane split is not itself a finding. It neither remedies nor conceals the
security defects above.

## Residual risks and required gate disposition

- Fixture/native/packed mechanism evidence does not certify real OpenClaw
  compatibility, live credentials, domain quality, production readiness,
  Birth, or Delivery.
- Same-uid filesystem races remain relevant because the implementation and
  regression plans explicitly claim inode/symlink/replacement resistance.
- The safe-fs kernel reduces target mutation authority but does not protect code
  paths that hand reopened absolute pathnames to children or JavaScript cleanup.
- A caller-provided external digest is an integrity selector, not an
  authenticity anchor, when the caller can generate both artifact and digest.

Because Critical and Warning findings remain unhandled, this audit recommends:

1. do not mark Plan 04-19 complete;
2. do not advance Phase 4 to canonical passed/satisfied;
3. fix the findings with deterministic adversarial tests;
4. rerun the bounded focused/full/pack/diff gates on the corrected source state;
5. dispatch a fresh canonical reviewer and verifier only after the execute-phase
   summary exists.

No `gsd-verifier` was called or simulated, and this report did not modify
`04-REVIEW.md`, `04-VERIFICATION.md`, STATE, ROADMAP, or REQUIREMENTS.
