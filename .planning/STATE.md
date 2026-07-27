---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: executing
stopped_at: "Incremental AgentMo-only POC reached declaration-only scaffold; Stage 2 extraction-field overclaim fixed and exact POC inputs replayed"
last_updated: "2026-07-27T00:00:00+08:00"
last_activity: 2026-07-27
last_activity_desc: Incremental POC evidence classified; declaration-only facts capped below supported and exact POC Plan replayed
progress:
  total_phases: 8
  completed_phases: 3
  total_plans: 56
  completed_plans: 53
  percent: 38
current_phase: 02
current_phase_name: codex-builder
---

# Project State

## Project Reference

See: .planning/PROJECT.md (updated 2026-07-27)

**Core value:** 开发者能够反复把经过批准的数据与人工决策转化为可安装、可验证的 Agent Package，并清楚知道其来源、能力、运行时行为和剩余风险。
**Current focus:** Phase 2 — independently confirm corrected Plan evidence semantics, then enter Phase 3 live collector work

## Current Position

Phase: 2 (codex-builder) — EXECUTING
Plan: 24 of 27 completed; 02-25～02-27 remain human-gated
Status: incremental POC reached declaration-only scaffold; Stage 2 evidence overclaim fixed and locally replayed; real Codex UAT remains incomplete
Last activity: 2026-07-27 — replayed the exact POC Plan as 0 supported / 13 partial / 1 missing after the semantic fix

Progress: [████░░░░░░] 38%

## Performance Metrics

**Velocity:**

- Total plans completed: 53
- Average duration: -
- Total execution time: -

**By Phase:**

| Phase | Plans | Status |
| --- | --- | --- |
| 1 | 4/4 | Complete |
| 1.1 | 13/13 | Complete |
| 1.2 | 12/12 | Complete |
| 2 | 24/27 executed | Local mechanism gate passed; 3 human-gated real-UAT plans remain |
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
- [Phase 3 evidence]: The same POC independently confirms that current Discover cannot fetch recent Web/GitHub/paper sources. Allowlist-bound live collection and provenance must be implemented as a Phase 3 vertical slice, not represented as a Phase 2 documentation success.
- [Phase 3]: collector 的 API、许可、限流与 provenance 需要 adapter-specific research。
- [Phase 4-5]: OpenClaw CLI/JSON、bundle/plugin precedence、permission 与 doctor surface 需要按实施版本复验。
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

Last session: 2026-07-27
Stopped at: exact incremental POC Plan replay confirms the semantic fix; independent rerun and Phase 3 live collector remain next
Resume file: None
