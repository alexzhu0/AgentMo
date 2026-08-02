---
phase: 03-build-contract
plan: "04"
subsystem: decision-ledger
tags: [decision-ledger, immutable-journal, trace-graph, plan, blueprint]
requires:
  - 03-03 exact discovery approval
provides:
  - Typed predecessor-bound durable Plan state
  - Fresh-process decision-ledger append and inspect
  - Exact ledger-head design-plan admission
  - Closed bidirectional source/decision/requirement/capability/eval trace graph
affects: [03-05-build-contract, 03-06-composed-gate, phase-04-package]
requirements-completed: [PLAN-01, PLAN-02, PLAN-03]
completed: 2026-07-28
status: complete-uncommitted
---

# Phase 03 Plan 04: Durable Decision Ledger and Bidirectional Trace Summary

AgentMo can now resume Plan from exact artifacts plus one typed, append-only decision lineage instead of relying on chat history or a raw transcript.

## Delivered

- Added `agentmo.decision-ledger.v1` as a typed wrapper over the existing crash-consistent immutable journal.
- Added five closed entry kinds: `fact`, `inference`, `unknown`, `rejected-option`, and `human-decision`.
- Every durable entry binds a stable ID, contiguous sequence, predecessor digest, canonical value digest, bounded subject/reason, and sorted source/decision/requirement refs.
- Added public `decision-ledger append|inspect`. Append exact-admits one `agentmo.decision-entry.v1` file; successors require the exact current head digest. Neither route accepts transcript or stdin authority.
- Added `artifact-contract decision-entry` so black-box operators can obtain the five closed entry kinds, field schema, and a production-validator-valid minimal template without reading source.
- `design-plan` now requires the exact current ledger head and emits closed, sorted forward/reverse edges across source, decision, requirement, capability, and eval nodes.
- Blueprint drafting carries bounded trace references while remaining `draft-non-authoritative`; exact admission no longer self-reports human review.
- Closed npm, installed Builder, artifact registry, command subject, help, documentation, release, and static I/O inventories.

## Verification

- TDD RED: the ledger module was absent and trace-aware Plan tests rejected the old four-input contract.
- Ledger core and fresh-process CLI: 5/5 passed.
- Design-plan, blueprint draft, and Phase 3 fresh-process contract: 23/23 passed.
- Artifact admission: 13/13 passed.
- Artifact subject, command documentation, and exact I/O closure: 31/31 passed.
- CLI MVP, CLI surface, and stage contracts: 36/36 passed after removing the stale reviewed claim.
- Black-box contract/CLI/docs/decision-ledger aggregate: 48/48 passed after publishing the decision-entry contract.
- Complete affected Plan 03-04 aggregate: 109/109 passed.
- Packed Builder inventory: 1/1 passed with 77 total and 72 runtime assets; npm dry run included `src/decision-ledger.js`.
- Full `npm run check` was explicitly bounded after 5m19s in the known long Builder/UAT crash-recovery matrix: 351 passed, 0 failed, 1 skipped, and 68 tests were cancelled by the interruption. This is not reported as a full-green run.
- `git diff --check`: passed.
- No live network, `.env`, credential, local OpenClaw process, Wiki, scheduler, RAG database, or domain answer was exercised.

## Boundaries

- `human-decision` records caller-provided typed planning state; it does not authenticate a person or organization.
- Exact ledger lineage and bidirectional edges prove bounded planning mechanics only.
- A generated design plan or blueprint remains draft and does not certify package implementation, runtime behavior, domain quality, production readiness, or deployment approval.
- Changes remain local and uncommitted; no push or publication occurred.

## Next

Plan 03-05 should define the exact Package build contract, runtime feasibility, permissions, trust surfaces, unsupported capabilities, and explicit approval boundary.
