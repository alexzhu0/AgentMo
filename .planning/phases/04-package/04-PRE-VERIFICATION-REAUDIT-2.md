# NONCANONICAL PRE-VERIFICATION REAUDIT 2

> This is a fresh, advisory, non-self-certifying Phase 4 remediation re-audit. It does not run or simulate `gsd-verifier`, does not replace canonical review/verification, and does not prove Phase 4, OpenClaw `live-success`, domain quality, Birth, Delivery, production readiness, deployment approval, or wider compatibility.

**Reviewed:** 2026-08-02T10:45:34Z  
**Depth:** deep / adversarial / cross-module  
**Result:** **BLOCKED — one Critical and one Warning remain**  
**Findings:** **Critical 1 / Warning 1 / Info 0 / Total 2**

## Scope and evidence boundary

This re-audit is limited to the historical
`.planning/phases/04-package/04-PRE-VERIFICATION-REAUDIT.md` Critical 3 /
Warning 0 findings, Phase 4 root gaps 1..6, historical `CR-01..10` /
`WR-01..03`, `PACK-01..05`, and the current implementation, tests, and docs
that claim to remediate those boundaries.

The review traced:

- authority-root creation, plan/approval binding, ledger open, marker
  reservation, post-effect evidence, receipt derivation, recursive predecessor
  admission, and root replacement/recreation;
- Linux retained-FD config candidate creation, pathname/FD drift checks,
  publication, and recovery preservation;
- the Linux native subreaper/pidfd/`/proc` supervisor, `setsid` containment,
  timeout/output-limit settlement, and non-Linux before-spawn refusal;
- package directory/archive closure and npm source-only distribution;
- the bounded outer-timeout remediation and its inner failure semantics; and
- current operator/release certification claims.

No `.env`, network, real OpenClaw, real user/HOME mutation, sibling repository,
commit, canonical review/verification, or phase-status mutation was used. The
only written artifact is this report.

## Executive assessment

Historical C-01 and C-02 are materially closed. The new root binding fixes the
old replace/recreate replay: the exact root inode is in the install plan and all
three approval families, and apply verifies the external binding and same inode
before opening a ledger that no longer creates missing directories. The named
config candidate is retained, never pathname-unlinked, is checked against three
retained FDs before and after both invocations, and reports replacement/absence
without deleting the unknown pathname object.

The normal Linux `setsid` + ignored-stdio escape is also addressed in design:
the subreaper adopts descendants, pidfds avoid PID reuse, `/proc` discovery is
independent of PGID, and success requires the observed descendant set to become
empty. However, the implementation uses a lifetime-monotonic fixed table of
4096 tracked PIDs. Exited entries are never removed or reused. Once the table is
exhausted, a newly visible descendant is deliberately left untracked; a
`setsid` descendant is then outside both `signal_tracked(...)` and the original
PGID kill, and the supervisor exits after the fixed two-second proof window.
This can leave adversary-controlled code alive after AgentMo returns a failure.
Failing the receipt is necessary but does not contain the process or its later
effects, so historical C-03/root gaps 1 and 5 remain blocked.

The coordinating agent corrected the stale README/runbook process-group text
during this re-audit. One current contract inconsistency remains: Stage
Contracts retains pre-final expected package/gate numbers that contradict the
settled 103-entry/green gate record.

## Critical findings

### C-01 — The fixed, never-recycled pidfd table can abandon an untracked `setsid` descendant

**Severity:** Critical  
**Affected:** historical C-03, root gaps 1 and 5, historical `CR-09`, release
claim for the `setsid` remediation

**Files and lines:**

- `native/openclaw-process-supervisor.c:26-30`
- `native/openclaw-process-supervisor.c:88-107`
- `native/openclaw-process-supervisor.c:157-195`
- `native/openclaw-process-supervisor.c:197-219`
- `native/openclaw-process-supervisor.c:388-430`
- `native/openclaw-process-supervisor.c:457-473`
- `release/2026.08.02.md:18-20`
- `docs/STAGE_CONTRACTS.md:173-178`

**Issue:** `tracked_count` only increases. `refresh_pidfds` marks exited entries
`alive=false` but never closes/removes them or makes their slots reusable. After
4096 descendants have been observed over the lifetime of one allowed command,
`add_tracked` returns false for every later PID. `discover_descendants` then
sets `containment_error` and enters shutdown, but signaling covers only PIDs
already in `tracked[]` plus `kill(-direct, ...)`. A new child that has called
`setsid` is in neither set. After `KILL_PROOF_MS` (2000 ms), the supervisor
reports `descendant-unreapable` and exits anyway. Its surviving adopted child is
then reparented outside the supervisor and can continue delayed mutation.

The same unsafe terminal path applies when pidfd admission fails for another
reason: discovery knows a descendant exists but does not retain a signal
authority for it, and the proof timeout still ends by exiting the subreaper.

**Concrete Linux reproduction:** run the official supervisor around a helper
that creates and waits for more than 4096 short-lived children sequentially,
then starts one long-lived `detached:true, stdio:"ignore"` child that writes a
canary after three seconds and lets the direct parent exit. The table is full of
historical dead entries; the escaped child cannot be added, is outside the old
PGID, survives the two-second proof deadline, and can write after the supervisor
returns `processGroupClosed:false`, `quiescenceVerified:false`. The current
Linux tests cover ordinary grandchildren and one `setsid` descendant but never
exhaust or fail pidfd admission (`test/openclaw-credential-handoff.test.js:588-722`).

**Impact:** An approved but hostile/compromised OpenClaw process can keep code
running beyond AgentMo's bounded result, retain inherited accessible resources,
or perform delayed filesystem effects. The result is not falsely labeled
successful, but failure is not containment; returning while the process remains
live violates the remediation's core security boundary.

**Required fix:** Do not exit the subreaper while any discovered descendant
lacks an exact termination/reap proof. Recycle exited slots safely (close the
pidfd only after terminal identity has been accounted for), or use a dynamically
bounded structure with an OS-enforced maximum below its capacity. Capacity or
pidfd-admission failure needs a containment primitive that can still kill the
whole set (for example a dedicated cgroup/pid namespace with an empty-membership
proof); a time limit alone cannot convert unknown live descendants into a safe
return. Add Linux-native adversarial tests for more than 4096 sequential child
identities, simultaneous capacity overflow, and forced pidfd-open failure, each
with a `setsid` ignored-stdio delayed canary that must never appear after return.

## Warnings

### W-01 — Stage Contracts still presents pre-final package/gate evidence as current

**Severity:** Warning  
**Files and lines:**

- `docs/STAGE_CONTRACTS.md:173-194`
- `release/2026.08.02.md:42-63`
- `docs/MVP_RUNBOOK.md:466-474`

**Issue:** Stage Contracts says current-source full/pack/diff gates have not run
and expects 100 entries. The current release and runbook instead record the
settled 103-entry package and completed aggregate. Operators therefore cannot
tell whether the Stage Contract is describing a historical checkpoint or the
current gate state. Separately, the unqualified Stage Contract/release statement
that the `setsid` finding is remediated overstates the bounded-table
implementation described in C-01.

**Required fix:** Replace the pre-final Stage Contracts gate paragraph with the
current 103-entry/full-gate record, label superseded counts by source state, and
state that the capacity/pidfd failure in C-01 remains open. Preserve the shared
boundary that Darwin proves only before-spawn refusal and that all recorded
results are bounded mechanism evidence.

## Historical Critical 3 remediation status

| Historical item | Fresh status | Evidence |
| --- | --- | --- |
| C-01 — replaceable authority ledger | **CLOSED** | `src/openclaw-authority-root-binding.js:48-83,213-238` creates/verifies the exact target/root inode binding; `src/openclaw-install-plan.js:192-227` incorporates it into the plan digest; all three decisions bind it at `src/openclaw-install-approval.js:67-238`; apply cross-checks it before effects at `src/openclaw-install-transaction.js:146-180,219-223,255-303`; root replacement regression is at `test/openclaw-install-transaction.test.js:2429-2465`. Missing/recreated roots do not mint a compatible old binding. |
| C-02 — pathname unlink of retained candidate | **CLOSED** | Candidate creation retains three exact FDs (`src/openclaw-official-action-runner.js:470-519`), checks pathname/FD identity throughout (`:219-265,530-585`), and never unlinks the name. The deterministic replacement test preserves both replacement and retained candidate bytes (`test/openclaw-credential-handoff.test.js:461-514`). |
| C-03 — `setsid` ignored-stdio escape | **PARTIAL / BLOCKED** | Normal escape is covered by the Linux-only regression (`test/openclaw-credential-handoff.test.js:685-722`) and non-Linux refuses before spawn (`:768-790`). Fixed lifetime capacity and pidfd-admission failure can still abandon an untracked escape (C-01). |

## Six root gaps

| Gap | Fresh status | Conclusion |
| --- | --- | --- |
| 1 — authentic fresh probe/execution window | **PARTIAL / BLOCKED** | Fresh probe/private executable/closed env are retained; descendant containment fails after tracking authority exhaustion (C-01). |
| 2 — durable authority/credential confusion | **CLOSED for reviewed Phase 4 boundary** | Exact root inode is pre-bound through plan/approvals/markers/evidence/receipt; caller-selected roots and recreated inodes fail before marker/effect. Credential routes remain proposal-only/no-spawn. |
| 3 — retained-dirfd mutation/helper chain | **CLOSED for reviewed paths** | Target publication remains retained-dirfd; config candidate is FD-bound and named/preserved with no pathname cleanup. |
| 4 — non-self-certifying receipt | **CLOSED for reviewed paths** | Ledger identity flows through producer-auth post-state/action/finalization records and recursive receipt admission; receipt projection is recomputed rather than trusted. |
| 5 — observed genesis/executable lifecycle | **PARTIAL / BLOCKED** | Genesis/four lifecycle mechanism boundaries remain intact, but the external process window is not contained under supervisor capacity/admission failure (C-01). |
| 6 — temp-complete publication/recovery/packed closure | **CLOSED for reviewed paths** | Directory/archive nested closure is rechecked before and after publication; candidates and unknown recovery objects are itemized and preserved; npm package is source-only. |

## Historical `CR-01..10` / `WR-01..03`

| Item | Fresh status | Revalidation |
| --- | --- | --- |
| CR-01 | CLOSED | Apply performs a fresh production probe before ledger/effects. |
| CR-02 | CLOSED | Probe/carrier/descriptor/archive companions remain externally digest-bound and re-admitted. |
| CR-03 | CLOSED | Config final mutation uses retained-session `replaceExact`; private candidate is FD-bound. |
| CR-04 | CLOSED | Recovery uses fresh observation and preserves ambiguity; no reviewed pathname cleanup was found. |
| CR-05 | CLOSED | One canonical pre-bound root inode carries durable nonce and evidence state; replacement/recreation rejects old authority. |
| CR-06 | CLOSED | Credential commands remain closed, proposal-only, and no-spawn. |
| CR-07 | CLOSED | Complete receipt is rederived from canonical post-state/action/finalization evidence. |
| CR-08 | CLOSED | Plan, all approvals, markers, results, evidence, receipt, and predecessor admission carry the exact authority binding. |
| CR-09 | **PARTIAL / BLOCKED** | Private exec/cwd/env and normal `setsid` handling are present; supervisor capacity/pidfd failure can abandon a descendant (C-01). |
| CR-10 | CLOSED | Reviewed public/private publication and candidate paths preserve replacements and expose recovery work without pathname deletion. |
| WR-01 | CLOSED as bounded mechanism | Four lifecycle fixtures remain implemented; credential is honestly unsupported. |
| WR-02 | CLOSED | Absent genesis is derived and re-observed through retained safe-fs. |
| WR-03 | CLOSED | Approved nested suffix/collision/traversal validation remains in place. |

## `PACK-01..05`

| Requirement | Fresh status | Boundary |
| --- | --- | --- |
| PACK-01 | SATISFIED (bounded) | Manifest identity, bindings, compatibility, inventory, permissions, evidence, boundary, and risk remain closed. |
| PACK-02 | SATISFIED (bounded) | Declared prompt/skill/tool/hook/memory/eval/mapping resources are materialized without automatic activation. |
| PACK-03 | SATISFIED (bounded) | `src/package-produce.js:230-349` verifies the exact nested directory/archive closure before directory publication, after it, and after archive publication. |
| PACK-04 | SATISFIED (bounded) | Least-trust carriers remain selected; the native plugin requires the exact approved recipe; no MCP surface is added. |
| PACK-05 | SATISFIED (bounded) | The 103-entry dry-run includes required JS/native source and excludes compiled helpers, build receipts, authority state, evidence instances, `.env`, credential state, and npm lifecycle install hooks. |

## Bounded verification evidence

| Check | Fresh result |
| --- | --- |
| `node --test test/openclaw-process-supervisor.test.js test/openclaw-credential-handoff.test.js test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js test/openclaw-install-evidence.test.js test/openclaw-install-transaction.test.js test/openclaw-safe-fs.test.js test/package-produce.test.js test/package-archive.test.js test/phase4-contracts.test.js` | exit 0; 103 tests, 98 pass, 0 fail, 5 Linux-only skip |
| `npm pack --dry-run --json --cache /private/tmp/agentmo-npm-cache-reaudit2-current` | exit 0; 103 entries; 555,091 packed bytes; 2,918,892 unpacked bytes; shasum `b9bc15a933bfb83bd42c1fada73ccbde667becf0` |
| package forbidden-surface inspection | no compiled helper, helper receipt, authority state, evidence instance, `.env`, credential state, or npm install/preinstall/postinstall hook in the dry-run inventory |
| `git diff --check` | exit 0 before this audit artifact was added |

Green tests do not negate C-01: every runtime containment test is skipped on
Darwin, and the source-only inventory test checks primitive names rather than
capacity/failure semantics.

## Environmental release gate

The Linux native adversarial runtime suite was not executable on this Darwin
host. This absence is **not counted as a code finding**. It **does block final
Phase 4** because the repository's current release/runbook contract explicitly
keeps Linux-native runtime execution as a mandatory release gate, and the only
tests that execute subreaper/pidfd/`/proc` behavior were skipped here. Even after
C-01 is fixed, Phase 4 cannot receive a final pass from this evidence set until
Linux runs normal descendant, `setsid` ignored-stdio, timeout/output-limit,
tracking-capacity, and pidfd-admission-failure adversarial cases.

---

_Reviewed: 2026-08-02T10:45:34Z_  
_Reviewer: gsd-code-reviewer (fresh noncanonical re-audit)_  
_Canonical status authority: unchanged; verifier/post gate not run_
