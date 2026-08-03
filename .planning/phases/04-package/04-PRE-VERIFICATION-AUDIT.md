# NONCANONICAL PRE-VERIFICATION AUDIT

This report is **advisory and non-self-certifying**. It is input to the
execute-phase post gate only. It does not replace the canonical code review or
verifier, change phase/roadmap/requirement status, or certify live OpenClaw,
domain quality, Birth, Delivery, production readiness, deployment, or wider
compatibility.

**Audit date:** 2026-08-03

**Reviewed commit:** `d943bc02d62bc78b743400d5d1eef36dc2704525`

**Exact CI gate:** GitHub Actions run `30799041760`, completed/success, 8/8 jobs

**Result:** BLOCKED — Plan 04-19 Task 3's no-open-Critical/Warning condition is not met

**Findings:** Critical 3, Warning 1, Suggestion 0

## Scope and evidence boundary

The fresh source and call-chain review covered root gaps 1..6, `CR-01..10`,
`WR-01..03`, `PACK-01..05`, Plan 04-13 helper admission, Plan 04-14 marker
crash/race semantics, the high/critical ASVS L1 mitigations in Plans 04-12
through 04-19, and the historical supervisor capacity, signal, bootstrap, and
x32 fixes.

The exact green gate is valid bounded mechanism evidence, but it does not test
the three Critical transitions below. No `.env`, secret value, raw provider
payload, transcript, credential-bearing OpenClaw state, live OpenClaw target, or
sibling repository was read or exercised.

## Exact gate binding

| Evidence | Result |
| --- | --- |
| Source commit | `d943bc02d62bc78b743400d5d1eef36dc2704525` |
| Workflow run | `30799041760`, completed/success at the exact source SHA |
| Native supervisor boundary | success; Ubuntu 24.04 / Node 20; 1m12s |
| Main regression shards 0..5 | all success; Ubuntu 24.04 / Node 24 |
| Syntax, packed behavior, and publication | success; Ubuntu 24.04 / Node 24; 35m30s |
| Total | 8/8 jobs successful |

This closes the infrastructure prerequisite for this audit. It is not a
canonical Phase 4 verdict.

## Coverage matrix

### Root gaps 1..6

| Set | Advisory status | Conclusion |
| --- | --- | --- |
| Root gap 1 — fresh execution window | **BLOCKED** | Verified executable identities are released before pathname-based execution, and clock failure can hang containment (CR-A2, CR-A3). |
| Root gap 2 — durable authority | **BLOCKED transitively** | Marker behavior is conditional on executing the admitted filesystem kernel; compile/output provenance is not proven (CR-A1). |
| Root gap 3 — retained-dirfd mutation | **BLOCKED** | The kernel's source logic is retained-dirfd based, but its admitted binary can be substituted at the compiler output path (CR-A1). |
| Root gap 4 — non-self-certifying receipt | **BLOCKED transitively** | Substituted helper/supervisor bytes can manufacture evidence outside the reviewed source mechanism (CR-A1, CR-A2). |
| Root gap 5 — observed lifecycle execution | **BLOCKED** | Final exec is pathname based and persistent post-bootstrap clock failure prevents bounded settlement (CR-A2, CR-A3). |
| Root gap 6 — publication/recovery | **BLOCKED transitively** | Publication/recovery guarantees depend on the unproven filesystem-kernel binary (CR-A1). |

### Historical findings and requirements

| Set | Advisory status | Re-check |
| --- | --- | --- |
| CR-01/02 | CLOSED for the original defects | Fresh production reprobe and explicit input companion admission remain present. |
| CR-03/04/05/07/08/10 | Source logic repaired; system guarantee **BLOCKED** | End-to-end guarantees depend on the compiler/output relationship that CR-A1 shows is unproven. |
| CR-06 | CLOSED | Credential routing remains closed and proposal-only/no-spawn outside admitted forms. |
| CR-09 | **OPEN** | Verified bytes are not retained through final exec and clock failure can hang containment (CR-A2, CR-A3). |
| WR-01..03 | CLOSED for bounded fixture semantics | Four lifecycle fixtures, observed genesis, and suffix-preserving projection remain present. |
| PACK-01..05 | SATISFIED only for bounded offline package/inventory/determinism/inspection | No runtime activation, domain-quality, or production claim follows. |
| Plan 04-13 helper admission | **FAIL** | Receipt fields independently identify source, compiler, and resulting pathname bytes but do not prove the compiler produced those bytes (CR-A1). |
| Plan 04-14 marker crash/race | Conditional primitive behavior present; system guarantee **BLOCKED** | A substituted filesystem helper can bypass the reviewed marker implementation (CR-A1). |
| Supervisor capacity/signal/bootstrap/x32 | PARTIAL | Capacity recycling, signal denial, and the pre-exec handshake are present. CR-A2/A3 remain; x32 has source-policy inspection but no filter-level or runtime regression (WR-A1). |
| ASVS L1 high/critical mitigations, Plans 04-12..19 | **BLOCKED** | 04-12 execution, 04-13 supply chain, 04-14 marker, 04-15 dispatcher, 04-16 evidence, and 04-17 publication guarantees are blocked directly or transitively. Packed/audit-boundary controls pass only within their bounded scope. |

## Critical findings

### CR-A1 — Build receipts do not prove the compiler produced the admitted binary

**Severity:** Critical

**Affected:** root gaps 2–4 and 6; CR-03/04/05/07/08/10; Plan 04-13;
Plan 04-14

`src/openclaw-safe-fs.js:170-184` observes source/compiler, invokes the compiler
through pathnames, then separately observes `stagingPath`.
`src/openclaw-safe-fs.js:185-229` publishes and records whatever bytes occupy
that pathname. Admission at `src/openclaw-safe-fs.js:334-354` rechecks current
source/compiler and the receipt-recorded binary digest, but never proves the
source-to-output relationship. The supervisor repeats the pattern at
`src/openclaw-process-supervisor.js:54-100` and `:209-220`.

A same-UID actor can replace the compiler output pathname after compilation and
before inspection. The receipt then authenticates attacker-selected bytes as
though they were compiled from the repository source. For the filesystem
kernel, this defeats retained-dirfd, no-replace, marker, recovery, and evidence
claims.

**Required follow-up:** Retain output identity across the compiler/evidence
boundary, or independently rebuild from exact retained source bytes and compare
the output. Add deterministic output-substitution races for both native
kernels.

### CR-A2 — Verified supervisor and target bytes are executed by replaceable pathname

**Severity:** Critical

**Affected:** root gaps 1 and 5; CR-09; Plans 04-12 and 04-15 mitigations

`src/openclaw-official-action-runner.js:55-102` creates and verifies a private
executable, returning only pathname and digest. The pathname is checked at
`:174-178`, then supervisor preparation creates a further replacement window.
`src/openclaw-process-supervisor.js:222-227` likewise returns an admitted
supervisor pathname without retaining executable identity. The runner spawns
that pathname at `src/openclaw-official-action-runner.js:859-895`, and
`native/openclaw-process-supervisor.c:539` calls `execv` on the target pathname
without an expected digest or retained executable handle.

The private directories are mode 0700, but another same-UID process can replace
their entries. This threat model already treats same-UID pathname replacement
as adversarial. Replacement can execute unapproved bytes or a fake supervisor
that emits successful protocol evidence.

**Required follow-up:** Execute from a retained no-follow descriptor using
`fexecve`, `execveat(AT_EMPTY_PATH)`, or an equivalent exact-byte mechanism.
Retain both supervisor and target identities through the final exec syscall and
add swap-after-admission and swap-during-build regressions.

### CR-A3 — Persistent post-bootstrap clock failure hangs containment

**Severity:** Critical

**Affected:** root gaps 1 and 5; CR-09; bootstrap/supervisor re-audits

`native/openclaw-process-supervisor.c:158-171` supports failures after an
arbitrary clock-call count. At `:591-595`, a runtime failure sets
`shutdown=true` with `now=-1`; at `:610-618`, `shutdown_at` becomes `-1`, so
subsequent persistent failures keep `now - shutdown_at` at zero and SIGKILL
escalation never occurs. The proof deadline at `:652-660` is also never reached.
`src/openclaw-official-action-runner.js:873-951` has no independent outer
watchdog. `test/openclaw-process-supervisor.test.js:275-289` covers only
`AGENTMO_TEST_CLOCK_FAIL_AFTER=0`, before target exec.

A SIGTERM-ignoring target can therefore remain alive while the public promise
never settles.

**Required follow-up:** Track clock validity separately from timestamp values,
escalate immediately when time cannot be measured, and add an independent outer
watchdog. Test `AGENTMO_TEST_CLOCK_FAIL_AFTER=1` with a SIGTERM-ignoring delayed
canary.

## Warning findings

### WR-A1 — Maintained evidence overstates x32 regression coverage

**Severity:** Warning

`test/openclaw-process-supervisor.test.js:68-120` checks only that x32-related
tokens exist in source. `.github/workflows/phase4-linux-supervisor.yml:55-69`
runs no x32 filter evaluator or x32 runtime case. The release record has been
narrowed to source-policy inspection.

**Required follow-up:** Add a filter-level test for native and
`__X32_SYSCALL_BIT` syscall numbers and an x32 runtime test where supported, or
continue to describe the evidence strictly as source-policy inspection.

## Final advisory disposition

The exact CI gate is green, but three Critical findings and one Warning remain.
Plan 04-19 Task 3 is not complete, `04-19-SUMMARY.md` must not be created as a
completion artifact, and the canonical post-gate reviewer/verifier must not be
used to certify Phase 4. Remediation and a fresh independent re-audit are
required first.
