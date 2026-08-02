---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
current_phase: 04
current_phase_name: package
status: executing
stopped_at: Phase 4 re-audit-3 findings remediated in source; Linux execution gate pending
last_updated: "2026-08-02T00:00:00Z"
last_activity: 2026-08-02
last_activity_desc: Phase 04 re-audit-3 Critical 3 and Warning 1 received targeted source/tests; Linux proof absent
progress:
  total_phases: 8
  completed_phases: 5
  total_plans: 81
  completed_plans: 77
  percent: 63
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-27)

**Core value:** 开发者能够反复把经过批准的数据与人工决策转化为可安装、可验证的 Agent Package，并清楚知道其来源、能力、运行时行为和剩余风险。
**Current focus:** Phase 04 — package

## Current Position

Phase: 04 (package) — EXECUTING
Plan: 19 of 19
Status: Gap closure blocked — re-audit-3 remediation implemented; Linux runtime proof required before another audit
Last activity: 2026-08-02 — signal/bootstrap/x32 controls added; 2 pass, 6 Linux-only skip on Darwin

Progress: [██████░░░░] 63%

## Performance Metrics

**Velocity:**

- Total plans completed: 59
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Status |
| --- | --- | --- |
| 1 | 4/4 | Complete |
| 1.1 | 13/13 | Complete |
| 1.2 | 12/12 | Complete |
| 2 | 24/27 executed | Local mechanism gate passed; 3 human-gated real-UAT plans remain |
| 3 | 6/6 | Complete; bounded live discovery, exact approvals, durable decisions, trace, strict build contract, and human gate closed |
| Phase 02 P02 | 45min | 2 tasks | 9 files |
| Phase 02 P03 | 70min | 2 tasks | 14 files |
| Phase 02 P04 | multi-pass implementation and hostile remediation | 2 tasks | 12 files |
| Phase 02 P05 | multi-pass implementation and hostile remediation | 2 tasks | packed runtime, projection, diagnosis, and security tests |
| Phase 02 P06 | multi-pass implementation and independent review remediation | 3 tasks | official host activation, shared references, and read-only diagnosis |
| Phase 02 P07 | multi-pass implementation and independent transaction-review remediation | 3 tasks | runtime lifecycle, sibling references, and explicit owner removal |
| Phase 02 P08 | multi-pass TDD and independent correctness remediation | 3 tasks | installed hook bridge, durable replay/CAS, packed chain, and UAT observation interface |
| Phase 02 P09 | multi-pass TDD and independent authority/CAS remediation | 3 tasks | value-blind UAT candidate transport, exact current-state admission, and packed closure |

## Accumulated Context

### Decisions

- [Roadmap]: 实施采用 8 个可验证纵向增量；原 Phase 1 拆为 1、1.1、1.2，且不会改变 `Discover -> Plan -> Produce` 三阶段生命周期。
- [Phase 1]: 新输出只使用 AgentMo identity；`agentmother_*` 只作为受控 legacy input，经 value-blind 迁移归一化。
- [Phase 1.1]: Durable artifact authority 是 exact raw bytes、subject digest 与必要的 source-authentic companion admissions；schema-valid 自写报告不能自我认证。
- [Phase 1.1]: 当前持久化/输出面统一经过 value-blind persistability gate。
- [Phase 1.2]: AgentMo core floor 与 OpenClaw target floor 分开；target mutations 使用真实 current-process authority 和精确范围 `>=22.19.0 <23 || >=23.11.0`。
- [Phase 1.2]: AgentMo 的唯一公开 runtime environment 选项是 `--runtime-env-file`；Bash helper 的本地选项只在进程边界转译。
- [Phase 1.2]: Node 20 evidence 绑定 repo-owned distribution trust anchor；producer 与 post-publication consumers 非循环分离。
- [Phase 1.2]: shell mutation authority 来自可证明的成功控制边，不来自文本顺序；OR、pipe、sequence、newline 与 disconnected 路径失败关闭。
- [Phase 6]: v1 仅交付 provider-neutral publish contract/test double；具体发布平台 adapter 仍留在 v2。
- [Phase 2]: Hook entry accepts hook-origin events only; approval and stage transition remain explicit core operations.
- [Phase 2]: Builder checkpoint publication uses bounded exact bytes and digest CAS; duplicate events bind ID, sequence, and canonical digest.
- [Phase 02]: 02-03 setup previews bind one project scope, and doctor trusts current packed release bytes instead of receipt-owned digests. — This closes cross-project apply replay and receipt self-certification while preserving value-blind project evidence.
- [Phase 2]: Upgrade/uninstall authority requires an externally admitted receipt digest and uses retained quarantine plus no-clobber publication before receipt-last commit.
- [Phase 2]: Projected package execution and repeat setup require an external exact receipt digest; local receipt/marker/assets cannot self-certify. Doctor uses a diagnostic-only non-executable view, and receipt rollback leaves its non-authoritative quarantine untouched rather than deleting through a mutable pathname.
- [Phase 2]: User-host activation requires explicit `hostScope=user`, fixed official Codex calls, an externally anchored receipt transition, separate selector-owner and sorted project-consumer evidence, and exact post-observation before receipt-last publication; hook trust remains human-owned.
- [Phase 2]: Project lifecycle removes only its exact consumer; selector removal is a separate zero-reference user-owner operation. Durable opaque reservations serialize owner/ledger writers, retain exact prior inodes, and treat filesystem finalization or irretractable receipts as explicit irreversible commit points.
- [Phase 2]: Installed hooks use a fixed adjacent launcher and exact projected receipt/release admission before the canonical reducer and checkpoint CAS. Durable cursor evidence owns replay identity beyond the bounded ledger; only digest-matching cursor-proven replay is normalized to duplicate.
- [Phase 2]: `agentmo.codex-uat.v1` is a `value-blind-operator-observation-candidate`, not a real-session attestation. Exact admission rechecks current release, receipt, owner, ledger, project consumer, host, launcher and hook-runner bindings; all broader certification flags remain false, including after later exact human admission.
- [Phase 2 D-29]: Codex currently exposes no AgentMo-verifiable hook-origin signature. Installed-runner input and same-user invocation therefore remain `value-blind-operator-observation-candidate`; challenge bytes provide correlation/replay protection only, and actual normal-trust/auth observation is human-owned.
- [Phase 2 D-30]: One append-only predecessor-bound `agentmo.codex-uat-attempt-journal.v1` is the sole UAT lifecycle authority. Checkpoint, receipt, host observation, snapshot, terminal evidence and candidate are immutable one-way exact references, not manifest/run/terminal/supervisor authorities or a mutual digest DAG.
- [Phase 2 D-31]: Real UAT success requires deterministic mechanism gates, actual human observation in one fresh isolated normal-trust/auth Codex session, and standalone exact human approval of the candidate/current journal head. Candidate publication follows `candidate-ready`; `human-admission` or `human-rejection` is a later journal successor and never upgrades domain, package, production, or wider compatibility claims.
- [Phase 2 Plan 02-17]: The packed release builder and standalone verifier passed exact fixture and full-regression gates; the sole actual attempt ended at the first `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED` terminal before `setup-applied`, activation, Codex start, scenarios, candidate, or human decision.
- [Phase 3 Plan 03-04]: Ongoing Plan authority is one typed predecessor-bound `agentmo.decision-ledger.v1` head. Entry kind does not authenticate a person; generated design/blueprint state remains draft until later exact plan approval.
- [Phase 3 Plan 03-05]: `agentmo.build-contract.v1` binds exact blueprint, design-plan, discovery-approval, and decision-ledger bytes to the inspected OpenClaw 29d018f0/2026.6.11 resource graph. `agentmo.plan-approval.v1` separately binds exact blueprint and contract bytes; it authorizes Produce admission only and certifies no package, install, runtime, domain, or production result.
- [Phase 3 Plan 03-06]: The one-source public HTTPS smoke and both exact-pair approvals were independently confirmed by the operator. Explicit evidence classes distinguish primary/first-party/context/community independently from trust, and arXiv enforces a 3000 ms request-start interval inside the aggregate deadline.
- [Phase 4 Plan 04-12]: OpenClaw probe authority now requires authentic external companions, executes only a verified private executable copy from a private cwd, and public apply must complete a fresh production reprobe before any journal or target effect.
- [Phase 4 Plan 04-13]: OpenClaw target observation, journal, create-only publication, and recovery now use an admitted retained-dirfd native kernel; helper build/apply is source/receipt/digest bound and reopened objects are preserved rather than deleted by pathname.
- [Phase 4 Plan 04-14]: Ordinary, sensitive, and conflict approvals consume durable per-family/per-nonce final markers before journal/effects; only a complete exact-attempt marker set and journal may resume, and credential argv is a closed official-route grammar.
- [Phase 4 Plan 04-17]: Package, archive, target descriptor, and target admission publish only after complete private staging through retained-dirfd native no-replace rename; prepublication temps and postpublication orphans remain separate preserved recovery evidence.
- [Phase 4 Plan 04-15]: Absent genesis now comes from repeated retained safe-fs observation, and one closed official dispatcher completes an isolated install→upgrade→rollback→uninstall predecessor chain while preserving unknown and modified state.
- [Phase 4 Plan 04-16]: Complete install receipts now require exact one-to-one authority/result closure against a full authentic companion graph; historical predecessor receipts cannot self-certify through structure or a recomputed digest.
- [Phase 4 Plan 04-18]: The extracted npm tarball now completes the public CLI helper-build→Produce→Inspect→fresh-probe→approval→four-lifecycle journey and exact packed security inventory without checkout runtime fallback.

### Pending Todos

None.

### Blockers/Concerns

- [Phase 2]: Codex plugin、agent 与 hook surface 会漂移，规划时必须以 current-host probe 为准。
- [Phase 2 historical failure]: Plan 02-17 ended at `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED`; the preserved attempt and its two-entry failure chain remain read-only and cannot resume into Codex UAT.
- [Phase 2 local gate 2026-07-24]: Plans 02-18 through 02-24 closed the reviewed UAT authority, host/install transaction, journal/leaf durability, private preflight authority, aggregate test, documentation, and zero-Critical review gates. The last completed aggregate was 760 passed, 0 failed, 1 skipped; the final deep review reported Critical 0 and Warning 0.
- [Phase 2 next]: Plans 02-25 through 02-27 remain `autonomous: false`. They cannot create a new attempt before exact prior-attempt admission and explicit approval, and local mechanism evidence must not be promoted into a real-session, domain-quality, OpenClaw, or production claim.
- [Cross-session POC]: The clean AgentMo-only black-box POC failed before Discover because operator-authored `agentmo.discovery.v1` and `agentmo.user-need.v1` fields were not publicly discoverable and schema failures collapsed into a generic admission error. It did not use GSD/Superpowers/OMX, mutate the repository, read `.env`, fetch sources, or run OpenClaw.
- [POC remediation]: Phase 2 now exports field-level contracts and validator-valid minimal templates, provides bounded Discover/need subcommand help, and returns secret-safe field issues after exact-digest identity admission. This does not implement live collection.
- [POC semantic remediation]: `extraction_field` declarations and unverified chunks can produce at most `partial`; `supported` requires multiple matching source-derived chunks with approved trust. Exact POC input replay now yields 0 supported, 13 partial, 1 missing, and 14 governed gaps.
- [Incremental POC]: Discover manifest materialization and Plan pass; handoff/scaffold materialize declarations only. No collector, normalizer/deduplicator, Wiki persistence/query, scheduler, restart recovery, live OpenClaw run, or test-question answer exists yet.
- [Validation 2026-07-27]: Stage 2 contract set passed 63/63. The post-fix aggregate completed 763 pass, 2 fail, 1 skip; the exact inventory failure was repaired and passed 17/17, while the load-sensitive packed-hook failure passed its isolated 98-second replay 1/1. A second 21-minute aggregate was intentionally not repeated.
- [Phase 3 historical POC gap]: The POC's no-live-collector finding was closed by the allowlist-bound Web/GitHub/arXiv collector and approved local intake; this does not imply Wiki, package, runtime, or domain readiness.
- [Phase 3 validation 2026-07-28]: Plan 03-04 affected aggregate passed 109/109, packed runtime inventory passed 1/1, npm dry-run included `src/decision-ledger.js`, and `git diff --check` passed. The full aggregate was explicitly bounded after 5m19s at 351 pass, 0 fail, 1 skip, 68 cancelled in unrelated long Builder/UAT matrices; it is not a full-green claim.
- [Phase 3 black-box discoverability 2026-07-28]: `artifact-contract decision-entry` exports the five closed entry kinds and a production-validator-valid minimal template; contract/CLI/docs/decision-ledger closure passed 48/48.
- [Phase 3 validation 2026-07-28, Plan 03-05]: Complete affected aggregate passed 165/165; packed Builder exact inventory passed 2/2 with 79 total / 74 runtime assets; npm dry-run contained 80 entries including the build-contract and plan-approval modules. The long packed recovery matrix was bounded after 342 seconds at 3 pass, 0 fail, 1 cancelled; full `npm run check` was likewise explicitly interrupted in the pre-existing crash-recovery matrix after syntax and early suites showed no failure.
- [Phase 4-5]: OpenClaw CLI/JSON、bundle/plugin precedence、permission 与 doctor surface 需要按实施版本复验。
- [Phase 4 gap closure 2026-08-02]: The historical Critical 3 received targeted remediation. Fresh re-audit 2 then reported Critical 1 / Warning 1: monotonic pidfd capacity plus stale Stage Contracts. Current source recycles terminal slots, inherits a seccomp `setsid`/`setpgid` group lock, adds three Linux-only adversarial regressions, and corrects the docs. The latest aggregate attempt reached main 956/0/10 and packed hook 1/1; after one load-sensitive replay received a test-first 60-second inner / 90-second outer bound, packed behavior passes 8/8. Linux runtime execution, re-audit 3, canonical review, and verifier remain pending.
- [Phase 4 re-audit 3 2026-08-02]: Fresh review reported Critical 3 / Warning 1 for supervisor signaling, post-fork bootstrap failure, x32 syscall bypass, and missing coverage. Current source withholds exec behind a pidfd/clock handshake, makes the supervisor non-dumpable, denies outbound signal/pidfd-signal/ptrace syscalls, rejects x32 on x86_64, and adds three more Linux regressions. Darwin proves only the source contract/non-Linux branch: 2 pass, 6 Linux-only skip. Linux execution must precede another fresh audit.
- [Phase 6]: 发布 provider 尚未选择；中文写作 bounded case set、rubric、阈值与 hard failures 尚待规划。
- [Phase 1.2 remaining risk]: provider-backed target live execution 未执行；Node 20 evidence 只覆盖 20.20.2 arm64，且不构成领域或生产认证。

### Roadmap Evolution

- Phase 1 edited: User-approved split: Phase 1 narrowed to CORE-01/02/03; artifact admission and runtime work moved to 1.1/1.2.
- Phase 1.1 inserted after Phase 1: Artifact admission and persistence safety split from original Phase 1.
- Phase 1.2 inserted after Phase 1.1: OpenClaw runtime and release evidence split from original Phase 1.
- Phase 1 completed on 2026-07-12: CORE-01/02/03 verified 7/7 with code-review remediation closed.
- Phase 1.1 completed on 2026-07-13: CORE-04/EVID-03 verified 10/10; review clean, Nyquist compliant, 39/39 threats closed.
- Phase 1.2 completed on 2026-07-13: COMP-01 verified 5/5; 12/12 plans, anchored Node 20 receipt, exact release correspondence, clean independent review, and full regression closed.

## Deferred Items

| Category | Item | Status | Deferred At |
| --- | --- | --- | --- |
| v2 | 其他 coding-tool/target adapters、具体发布平台 adapter、大规模 discovery 与企业治理 | Deferred | v1 roadmap |

## Session Continuity

Last session: 2026-07-29T06:51:16.123Z
Stopped at: Phase 4 planning complete; ready to execute 04-01
Resume file: .planning/phases/04-package/04-CONTEXT.md
