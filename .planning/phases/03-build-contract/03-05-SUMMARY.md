---
phase: 03-build-contract
plan: "05"
subsystem: build-contract
tags: [openclaw, build-contract, plan-approval, exact-digest, resource-projection]
requires:
  - 03-03 exact discovery approval
  - 03-04 decision-ledger head and bidirectional Plan trace
provides:
  - Strict source-grounded Agent Package build contract
  - Exhaustive OpenClaw resource and lifecycle projection
  - Separate exact-byte Produce-entry approval
  - Closed public build-contract and plan-approve commands
affects: [03-06-composed-gate, phase-04-package, phase-05-runtime]
requirements-completed: [PLAN-03, PLAN-04, PLAN-05]
completed: 2026-07-28
status: complete-uncommitted
---

# Phase 03 Plan 05: Strict Package Build Contract and Approval Boundary

AgentMo can now close Plan with an inspectable, exact-bound construction contract instead of passing a prompt-only scaffold into Produce.

## Delivered

- Added `agentmo.build-contract.v1`, binding exact blueprint, design-plan, discovery-approval, and decision-ledger bytes.
- Pinned the inspected OpenClaw target to source revision `29d018f0`, version `2026.6.11`, and Node range `>=22.19.0 <23 || >=23.11.0`.
- Declared 22 closed resource families covering prompt/workspace context, skills, tools/policy, plugins, memory, RAG, storage, schedules, harness, loop/runtime binding, permissions/trust/secrets, install/load/execute transitions, recovery, acceptance, and evidence.
- Added detailed construction semantics for prompt budgets, skill eligibility and limits, effective tool policy, plugin scan/activation/rollback, exclusive memory ownership, RAG/index/fallback/citations, database lifecycle, cron isolation/idempotency, bounded attempts and tool-loop guards, and recovery.
- Every resource has one stable ID, one Phase 3/4/5 lifecycle, exact trace references, permission/failure semantics, one projection disposition, and one evidence obligation.
- Extended the Plan trace graph through permissions, acceptance cases, resources, and evidence obligations with exact reverse edges.
- Added `agentmo.plan-approval.v1` with a write-free preview and explicit apply. Apply requires `approve: true`, the exact preview digest, exact blueprint bytes, and exact build-contract bytes.
- Approval coverage hashes all requirements, capabilities, permissions, acceptance cases, resources, and evidence obligations. Any change makes the old approval stale.
- Added public `build-contract` and `plan-approve` command routes, artifact registry/subject closure, value-blind admission, package inventory, help, and exact static I/O ownership.

## Verification

- Contract, projection, approval, and fresh-process Phase 3 suites: 9/9 passed.
- Contract plus persistability aggregate: 24/24 passed.
- Complete affected aggregate including Stage 2, CLI, artifact admission, command docs, static I/O, and Stage contracts: 165/165 passed.
- Packed Builder exact inventory and hostile inventory checks: 2/2 passed; 79 total / 74 runtime assets.
- npm package dry run: 80 entries and both new runtime modules present.
- The longer packed recovery matrix was explicitly bounded after 342 seconds at 3 passed, 0 failed, and 1 cancelled.
- `npm run check` completed syntax checks and early suites without failure, then was explicitly interrupted in the pre-existing long crash-recovery matrix.
- No `.env`, live Internet, real OpenClaw process, credential, Wiki, scheduler application, runtime database, RAG query, or domain answer was used.

## Boundaries

- The contract is construction intent, not a generated or installed package.
- Plan approval is local operator intent to enter Produce, not authenticated organization approval.
- No OpenClaw configuration, plugin, schedule, database, user state, or runtime was mutated.
- No declared or test evidence certifies runtime success, domain quality, wider OpenClaw compatibility, production readiness, or deployment.
- Changes remain local and uncommitted; no push, tag, release, or npm publication occurred.

## Next

Plan 03-06 should execute the composed black-box Phase 3 gate and prove a clean handoff from approved discovery and durable decisions through exact build contract and plan approval, while still stopping before Phase 4 package generation or mutation.
