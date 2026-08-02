# NONCANONICAL PRE-VERIFICATION REAUDIT 3

> This is a fresh, advisory, non-self-certifying Phase 4 remediation re-audit. It does not run or simulate `gsd-verifier`, does not replace canonical review/verification, and does not prove Phase 4, OpenClaw `live-success`, domain quality, Birth, Delivery, production readiness, deployment approval, or wider compatibility.

**Reviewed:** 2026-08-02T12:04:04Z
**Depth:** deep / adversarial / cross-module
**Result:** **BLOCKED — three Critical findings and one Warning remain**
**Findings:** **Critical 3 / Warning 1 / Info 0 / Total 4**

## Scope and evidence boundary

This re-audit independently reviewed the remediation of Critical 1 / Warning 1
from
`.planning/phases/04-package/04-PRE-VERIFICATION-REAUDIT-2.md`, while
sanity-checking the three earlier historical Critical closures, Phase 4 root
gaps 1..6, historical `CR-01..10` / `WR-01..03`, and `PACK-01..05`.

The review traced:

- terminal pidfd slot recycling, ordering before descendant discovery,
  descendant signaling/reaping, simultaneous capacity overflow, and pidfd-open
  failure;
- the pre-exec seccomp architecture guard, `NO_NEW_PRIVS`, `setsid`/`setpgid`
  denial, filter inheritance, and the original-PGID plus subreaper fallback;
- the JavaScript supervisor caller's abnormal-close and timeout behavior;
- Linux-only delayed-canary regressions and their Darwin skip status;
- the installed-hook 60-second child / 90-second outer timeout contract;
- maintained Stage Contracts, README, runbook, runtime notes, and release
  evidence; and
- the exact npm publication closure.

No `.env`, network, real OpenClaw, real user/HOME mutation, sibling repository,
commit, canonical review/verification, verifier, state, roadmap, or requirements
mutation was used. The only written artifact is this report.

## Executive assessment

The lifetime-monotonic pidfd defect from re-audit 2 is fixed on the normal loop:
`refresh_pidfds` establishes terminal status or pidfd liveness, then
`compact_tracked` closes terminal pidfds and reuses their slots before the next
`discover_descendants` call
(`native/openclaw-process-supervisor.c:254-293,461-471`). The simultaneous
capacity and post-direct pidfd-admission fallbacks also keep untracked processes
in the original group because the inherited filter denies ordinary
`setsid`/`setpgid`; their Linux tests use a genuine delayed canary.

That does not close the containment theorem. First, the supervised same-UID
command can `SIGKILL` or `SIGSTOP` its supervisor because the filter permits all
signal syscalls. `SIGKILL` abandons the group and produces only a protocol
failure in the JavaScript caller; `SIGSTOP` defeats the supervisor's internal
deadline and leaves the caller pending indefinitely. Second, the initial direct
pidfd-open failure and the post-fork clock failure kill only the direct PID and
return without group or adopted-descendant closure. Third, on x86_64 the
architecture guard does not distinguish the x32 ABI: an x32 `setsid` or
`setpgid` syscall carries `__X32_SYSCALL_BIT`, misses both equality checks, and
is allowed. These are independent ways to return or hang without the claimed
descendant closure.

The 60-second installed-hook child bound and 90-second outer bound preserve the
required 30-second margin and retain fail-closed rejection. Documentation
correctly distinguishes the pre-fix aggregate from the later corrected 8/8
packed-behavior lane, but its unconditional containment wording now overstates
the three defects below. The npm package remains an exact 103-member,
source-only closure with both native sources and the authority-root/supervisor
JavaScript modules, and without compiled helpers, receipts, authority/evidence
instances, or lifecycle install hooks.

## Critical findings

### C-01 — A supervised command can kill or stop the supervisor and escape all settlement

**Classification:** BLOCKER / Critical
**Affected:** historical C-03, root gaps 1 and 5, historical `CR-09`

**Files and lines:**

- `native/openclaw-process-supervisor.c:91-120`
- `native/openclaw-process-supervisor.c:427-435`
- `src/openclaw-official-action-runner.js:873-951`
- `docs/STAGE_CONTRACTS.md:173-180`
- `README.md:93-97`
- `release/2026.08.02.md:18-27`

**Issue:** The inherited seccomp filter denies only `setsid` and `setpgid`; it
does not prevent the same-UID direct child or one of its descendants from
signaling the C supervisor. The direct child knows the supervisor PID as its
parent PID. `SIGKILL` terminates the subreaper immediately, so no code remains to
TERM/KILL the original group, enumerate `/proc`, reap adopted children, or emit
the success/failure protocol. The JavaScript wrapper treats the empty protocol
as a bounded protocol failure but performs no independent descendant cleanup.
The direct process and its descendants can therefore perform delayed effects
after AgentMo returns failure. `SIGSTOP` is worse: the C process cannot execute
its internal timeout, and the JavaScript wrapper has no independent deadline,
so the install call can remain pending indefinitely.

**Concrete Linux reproduction:** use an otherwise valid official-process
fixture whose executed JavaScript does the following:

```js
import { writeFileSync } from "node:fs";
process.kill(process.ppid, "SIGKILL");
setTimeout(() => writeFileSync(process.argv[2], "late"), 400);
setInterval(() => {}, 1000);
```

`runOpenClawOfficialProcess` observes the supervisor close without a protocol
and returns a failure; after that return, the delayed marker is written. Replace
`SIGKILL` with `SIGSTOP` and the returned promise does not settle because only
the stopped supervisor owns `timeout_ms`. The group lock does not help: both
signals target the supervisor, not a forbidden process-group transition.

**Required fix:** Put termination authority outside the supervised command's
signal/UID boundary. A robust design is an externally owned cgroup/pid-namespace
boundary whose `cgroup.kill` and empty-membership proof remain available even
when the in-group supervisor dies. If seccomp is retained as an additional
layer, comprehensively deny every route that can signal or control the
supervisor (`kill`, `tkill`, `tgkill`, queued-signal variants,
`pidfd_send_signal`, `ptrace`, and equivalent routes) with an exact supervisor
identity policy, and add an independent outer watchdog that can terminate and
prove the whole containment set closed. Add Linux regressions for both
`SIGKILL` plus a post-return delayed canary and `SIGSTOP` plus bounded outer
settlement.

### C-02 — Initial pidfd/clock bootstrap failures return after killing only the direct PID

**Classification:** BLOCKER / Critical
**Affected:** re-audit-2 Critical remediation, root gaps 1 and 5, historical
`CR-09`

**Files and lines:**

- `native/openclaw-process-supervisor.c:70-78`
- `native/openclaw-process-supervisor.c:145-165`
- `native/openclaw-process-supervisor.c:435-448`
- `test/openclaw-process-supervisor.test.js:171-195`

**Issue:** After `fork`, the parent ignores the `setpgid` result and tries to
pidfd-admit the direct child. If that admission fails, it sends `SIGKILL` only
to `direct`, waits only for `direct`, and returns 78. The same direct-PID-only
cleanup occurs when the first monotonic clock read fails. The child can be
scheduled first, complete its pre-exec group lock, execute the approved target,
and fork a descendant before the parent enters either failure branch. Killing
only the direct PID then reparents the descendant through the subreaper, but the
subreaper exits immediately without enumerating, group-killing, or reaping it.

The forced-pidfd test does not cover this branch: it compiles with
`AGENTMO_TEST_PIDFD_FAIL_AFTER=1`, so the direct child's first non-self pidfd
always succeeds and only a later descendant admission fails. No test uses
`AGENTMO_TEST_PIDFD_FAIL_AFTER=0`.

**Concrete Linux reproduction:** compile with
`-DAGENTMO_TEST_PIDFD_FAIL_AFTER=0` and execute a small direct helper that forks
an ignored-stdio child immediately; the child waits 400 ms, writes a marker,
and stays alive. Repeating the invocation exercises the permitted scheduling
where the helper forks before the supervisor's forced direct admission
failure. The supervisor returns 78 after reaping only the helper, and the
marker appears afterward. A deterministic regression can add a test-only
barrier/delay to the forced failure branch so the helper confirms its fork
before pidfd admission returns `EMFILE`.

**Required fix:** Every failure after `fork` must enter the same containment
state machine as timeout/output/capacity failure. Retain the original PGID,
signal the entire group, enumerate/reap adopted descendants until an externally
enforced empty-set proof exists, and do not return merely because the direct PID
was reaped. Add separate Linux tests for direct admission failure
(`AGENTMO_TEST_PIDFD_FAIL_AFTER=0`) and a forced post-fork clock failure, each
with a delayed canary checked after supervisor return.

### C-03 — The x86_64 seccomp architecture guard allows x32 `setsid` and `setpgid`

**Classification:** BLOCKER / Critical
**Affected:** re-audit-2 Critical remediation, historical C-03, root gaps 1 and
5, historical `CR-09`

**Files and lines:**

- `native/openclaw-process-supervisor.c:42-48`
- `native/openclaw-process-supervisor.c:91-112`
- `test/openclaw-process-supervisor.test.js:63-103`
- `test/openclaw-credential-handoff.test.js:685-725`

**Issue:** On x86_64, the filter checks only
`seccomp_data.arch == AUDIT_ARCH_X86_64`, then compares the syscall number
directly with native `__NR_setsid` and `__NR_setpgid`. The Linux x32 ABI uses the
same audit architecture but sets `__X32_SYSCALL_BIT` in `seccomp_data.nr`.
Therefore x32 `setsid`/`setpgid` numbers match neither rule and reach the final
`SECCOMP_RET_ALLOW`. The filter is inherited correctly and `NO_NEW_PRIVS` is
set correctly, but it inherits an incomplete policy.

**Concrete Linux reproduction:** on an x86_64 kernel with x32 enabled, compile
an x32 helper (`cc -mx32`) that calls `setsid`, ignores stdio, and writes a
delayed marker. Have the supervised target fill the bounded tracking table with
same-group live children, then execute this helper as the overflow child. Its
audit architecture passes the guard, its x32 `setsid` passes the native-number
checks, and capacity failure leaves it outside both the pidfd set and original
PGID. It can write after the supervisor's proof deadline. The current detached
test uses the native Node ABI and cannot detect this bypass.

**Required fix:** On `AUDIT_ARCH_X86_64`, reject x32 syscalls entirely before
the native syscall comparisons (for example, fail closed whenever
`nr & __X32_SYSCALL_BIT` is nonzero), or explicitly enforce the equivalent x32
denials. Keep the current fail-closed audit-architecture mismatch branch. Add a
filter-level regression that evaluates native and x32 syscall numbers even on
hosts without an x32 runtime, plus an x32 runtime delayed-canary test where the
kernel/toolchain supports it.

## Warnings

### W-01 — The Linux adversarial suite proves only a narrower fallback than the maintained claim

**Classification:** WARNING
**Files and lines:**

- `test/openclaw-process-supervisor.test.js:63-103`
- `test/openclaw-process-supervisor.test.js:118-195`
- `test/openclaw-credential-handoff.test.js:685-725`
- `docs/STAGE_CONTRACTS.md:173-180`
- `docs/OPENCLAW_RUNTIME_NOTES.md:118-123`
- `docs/MVP_RUNBOOK.md:452-458`

**Issue:** The recycle, simultaneous-capacity, and post-direct pidfd-failure
tests are meaningful for their chosen scenarios. They schedule a marker at
400 ms, await supervisor return, wait another 500 ms, and require the marker to
remain absent. The recycle test also uses a four-slot build and twelve
sequential identities, so it genuinely exercises slot reuse. However:

- forced failure begins only after the direct pidfd succeeds;
- no test lets the child signal the supervisor;
- no test exercises x32 syscall-number policy; and
- the source-inventory assertion checks for primitive names, not the complete
  security policy.

The maintained statement that the original process group retains a kill path
across capacity or pidfd-admission failure is therefore broader than the tested
and implemented theorem.

**Required fix:** Add the regressions required by C-01..C-03 and narrow the
maintained wording until they pass on Linux. Keep Darwin results explicitly
reported as skips/unsupported-before-spawn rather than passes.

## Re-audit-2 remediation status

| Re-audit-2 item | Fresh status | Evidence |
| --- | --- | --- |
| C-01 — lifetime-monotonic pidfd table | **PARTIAL / BLOCKED** | Terminal slots are recycled before discovery (`native/openclaw-process-supervisor.c:254-293,461-471`), and the tested post-direct capacity/admission cases use the original group. Direct pidfd bootstrap failure, supervisor signaling, and x32 group escape still permit unsafe outcomes (C-01..C-03 above). |
| W-01 — stale Stage Contracts evidence | **CLOSED for evidence labeling** | `docs/STAGE_CONTRACTS.md:189-196` labels the first settled 956/0/7 source separately, identifies the later re-audit, and leaves current full/Linux/audit gates outstanding. README/runbook/release separately record main 956/0/10 plus packed hook 1/1, the failed packed behavior 7/8 attempt, and corrected lane 8/8. Its unconditional containment prose must still be narrowed for C-01..C-03. |

## Historical Critical 3 remediation status

| Historical item | Fresh status | Evidence |
| --- | --- | --- |
| C-01 — replaceable authority ledger | **CLOSED for reviewed boundary** | Exact authority-root replay remains rejected before effects; the focused root-replay test passed 1/1. No regression was found in the plan/approval/ledger root binding. |
| C-02 — pathname unlink of retained candidate | **CLOSED for reviewed boundary** | The named candidate/FD identity path remains preserved; the focused config pair test passed 1/1 and no pathname cleanup was reintroduced. |
| C-03 — `setsid` ignored-stdio escape | **BLOCKED** | Native-ABI ordinary `setsid` is denied, but supervisor signaling, direct pidfd bootstrap failure, and x32 syscall-number bypass invalidate the claimed general closure. |

## Six root gaps

| Gap | Fresh status | Conclusion |
| --- | --- | --- |
| 1 — authentic fresh probe/execution window | **BLOCKED** | The target can kill/stop the supervisor or exploit post-fork bootstrap failure; x32 can bypass the group lock. |
| 2 — durable authority/credential confusion | **CLOSED for reviewed boundary** | Exact authority-root identity and proposal-only/no-spawn credential boundaries remain intact. |
| 3 — retained-dirfd mutation/helper chain | **CLOSED for reviewed boundary** | Retained candidate and identity-bound final publication remain intact. |
| 4 — non-self-certifying receipt | **CLOSED for reviewed boundary** | Complete receipt derivation remains producer-evidence-bound and fail-closed. |
| 5 — observed genesis/executable lifecycle | **BLOCKED** | External process containment is not closed under C-01..C-03. |
| 6 — temp-complete publication/recovery/packed closure | **CLOSED for reviewed boundary** | Recovery preservation and source-only npm closure remain intact. |

## Historical `CR-01..10` / `WR-01..03`

| Items | Fresh status | Revalidation |
| --- | --- | --- |
| `CR-01..08`, `CR-10` | **CLOSED for reviewed boundaries** | Fresh probe/companion admission, retained publication, preservation, canonical authority, no-spawn credentials, producer evidence, binding propagation, and no-delete recovery showed no regression in this scoped re-audit. |
| `CR-09` | **BLOCKED** | Private exec/cwd/env remain bounded, but supervisor control, direct bootstrap failure, and x32 filter policy leave descendant containment incomplete. |
| `WR-01..03` | **CLOSED for reviewed boundaries** | Four lifecycle fixture semantics, retained absence, and nested path/collision validation showed no scoped regression. Real lifecycle execution remains absent. |

## `PACK-01..05`

| Requirement | Fresh status | Boundary |
| --- | --- | --- |
| PACK-01 | SATISFIED (bounded) | Manifest identity, bindings, compatibility, inventory, permissions, evidence, boundary, and risk remain closed. |
| PACK-02 | SATISFIED (bounded) | Declared prompt/skill/tool/hook/memory/eval/mapping resources remain materialized without automatic activation. |
| PACK-03 | SATISFIED (bounded) | Deterministic directory/archive closure and publication rechecks showed no scoped regression. |
| PACK-04 | SATISFIED (bounded) | Least-trust carriers remain selected; no MCP surface or automatic plugin activation was added. |
| PACK-05 | SATISFIED (bounded) | The exact npm dry-run has 103 source members. It includes `native/openclaw-fs-kernel.c`, `native/openclaw-process-supervisor.c`, `src/openclaw-authority-root-binding.js`, and `src/openclaw-process-supervisor.js`; it excludes compiled helpers, helper/build receipts, authority state, evidence instances, `.env`, credential state, and `preinstall`/`install`/`postinstall`/`prepare` hooks. |

## Timeout and packed-behavior assessment

`plugin/hooks/agentmo-hook.js:25-26` declares a 60,000 ms authenticated child
deadline plus a 1,000 ms child settlement grace.
`src/builder-behavior-eval.js:43-49,625-689` gives each authentic hook/adjacent
CLI invocation a 90,000 ms outer deadline. The contract regression at
`test/builder-hook-supervisor.test.js:77-87` requires the outer bound to be at
least the child bound plus 30,000 ms and passed. The hook still destroys pipes,
kills the process group, and rejects on timeout, abnormal exit, output overflow,
stderr, surviving group, or malformed result
(`plugin/hooks/agentmo-hook.js:1826-1951`); the timeout change did not relax a
failure into success.

The orchestrator-provided current evidence records the exact previously failed
packed-behavior lane at **8/8, exit 0** after the 60s/90s correction. This
reviewer did not duplicate that long lane. Maintained docs correctly state that
the aggregate attempt itself reached main 956 pass / 0 fail / 10 skip and packed
hook 1/1, then packed behavior 7/8; they label the later isolated corrected
packed-behavior 8/8 separately rather than presenting the pre-fix aggregate as
a current full-green aggregate.

## Bounded verification evidence

| Check | Fresh result |
| --- | --- |
| focused supervisor/hook/docs/stage/source-only command | exit 0; 42 tests, 39 pass, 0 fail, **3 Linux runtime skips** |
| `node --test test/stage-contracts.test.js test/command-docs.test.js` | exit 0; 15/15 pass |
| exact npm member-to-inventory test | exit 0; 1/1 pass |
| focused named-candidate plus authority-root replay tests | exit 0; 2/2 pass |
| `npm pack --dry-run --json --cache /private/tmp/agentmo-npm-cache-reaudit3` | exit 0; 103 entries; 555,719 packed bytes; 2,921,197 unpacked bytes; shasum `8ec9dd8867057f9ee8d65e9bcee007626f32a5ed` |
| `cc -fsyntax-only -Werror native/openclaw-process-supervisor.c` on Darwin | exit 0; validates only the non-Linux branch |
| `git diff --check` before this report | exit 0 |
| exact corrected packed-behavior lane | orchestrator-provided current evidence: exit 0; 8/8 pass |

Passing tests do not negate C-01..C-03. The C runtime tests were skipped on
this Darwin host, and even a Linux run of the current suite does not exercise
the three identified paths.

## Environmental release gate

The absent Linux-native execution on this Darwin host is **not counted as a
code finding**. It remains a separate mandatory Phase 4 release gate. Darwin
proved unsupported-before-spawn and compiled only the non-Linux C branch; the
three native runtime tests were skipped, not passed. Final Phase 4 remains
blocked until Linux runs the normal descendant, native `setsid`, timeout,
output-limit, terminal-slot recycle, simultaneous-capacity, pidfd-admission,
direct-bootstrap-failure, supervisor-signal, and applicable x32/filter-level
adversarial cases—and until C-01..C-03 are fixed and independently re-audited.

---

_Reviewed: 2026-08-02T12:04:04Z_
_Reviewer: gsd-code-reviewer (fresh noncanonical re-audit)_
_Canonical status authority: unchanged; verifier/post gate not run_
