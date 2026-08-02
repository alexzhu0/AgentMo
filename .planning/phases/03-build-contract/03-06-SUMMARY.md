---
phase: 03-build-contract
plan: "06"
subsystem: phase-gate
tags: [discover-live, exact-approval, build-contract, openclaw, human-gate]
requires:
  - 03-01 bounded live discovery
  - 03-02 provider normalization
  - 03-03 exact discovery approval
  - 03-04 durable decision ledger and trace
  - 03-05 strict build contract and plan approval
provides:
  - Complete fresh-process Phase 3 contract gate
  - Human-verified bounded public HTTPS transport
  - Independently approved exact discovery and Produce-entry pairs
  - Synchronized Phase 3/4/5 ownership documentation
affects: [phase-04-package, phase-05-runtime]
requirements-completed: [DISC-01, DISC-02, DISC-03, DISC-04, DISC-05, DISC-06, PLAN-01, PLAN-02, PLAN-03, PLAN-04, PLAN-05]
completed: 2026-07-28
status: complete-uncommitted
---

# Phase 03 Plan 06: Composed Phase Gate and Human Verification

Phase 3 now closes with an exact, fresh-process chain from bounded discovery through explicit Produce-entry approval, without creating or executing an Agent Package.

## Delivered

- Added the canonical fresh-process integration gate covering live-discovery materialization, discovery approval preview/apply, typed decision-ledger reload, approved design plan, draft blueprint, complete OpenClaw build contract, and plan approval preview/apply.
- Proved every stale manifest, database, discovery approval, need, ledger, design plan, blueprint, or build contract fails before successor publication.
- Closed the exact Phase 3 output inventory, including the immutable decision-ledger sidecars, while proving absence of package, config, install, plugin, schedule, runtime, birth, domain, and delivery outputs.
- Synchronized README, runbook, stage contracts, migration guidance, MVP ledger, and release evidence around the implemented commands and the Phase 3/4/5 ownership boundary.
- Completed the blocking human verification over one bounded public HTTPS request and both exact approval pairs.

## Human-Gated Evidence

- The successful public HTTPS smoke used one fixed allowlist entry, `maxSources: 1`, 4 KiB maximum response bytes, 5-second per-source timeout, 8-second aggregate timeout, and zero redirects.
- The canonical result was HTTP 200 with 220 retained-byte length and remained `bounded-mechanism-only`, `context`, and `unverified`. No provider body, raw transcript, credential, or host path was promoted into repository evidence.
- Manifest/database approval:
  - manifest `sha256:808a689f7423f72b876cf797d5330b7ab31247e0ad942a55fa23cf3235afc8da`
  - database `sha256:1688c1e2345129c567e5b97c391d6daa678d4ea5197c179bea7891cdb3764c18`
  - approval artifact `sha256:b3b6485f5d121108918824f29c8096535952e2631306afb6bad4a05f69b0faf4`
- Blueprint/build-contract approval:
  - blueprint `sha256:fb3dfe071a5b0596b9047e6612345cc7d07b7836ab4013a67a3d97bd7c362d2a`
  - build contract `sha256:df32b04672c965afe158493f9a43bd226c2935dfd3e788aaa83df4606d5e2ab3`
  - approval artifact `sha256:b75508f4e7e47d41e72e88d5330d45121704c5874426fb9401b6fa4c4f144f3b`
- Mutating either approved predecessor produced `AGENTMO_ARTIFACT_DIGEST_MISMATCH`; neither attack created a stale approval artifact.

## Verification

- Phase 3 contract/artifact/document gate: 40/40 passed.
- Final complete Phase 3 focused implementation set: 165/165 passed.
- Independent post-remediation goal-backward recheck: 81/81 passed; Roadmap 5/5 and requirements 11/11 verified with no remaining gap or human item.
- `git diff --check`: passed.
- The previously attempted full `npm run check` remains explicitly inconclusive at its 90-second boundary in the known long Builder crash-recovery matrix; no full-green aggregate claim is made.
- No `.env` content was read. No commit, stage, push, tag, release publication, package generation, installation, OpenClaw execution, Wiki, scheduler application, runtime database, RAG query, or Agent answer occurred.

## Verification Remediation

- The initial independent verifier found that live evidence roles were adapter-hardcoded, arXiv's declared pacing was not executed, and migration guidance still treated Phase 2 recovery text as current.
- Added closed `source_inventory[].evidence_class` handling and behavioral tests for first-party/community independence from trust/confidence; arXiv now rejects non-primary classification before transport.
- Added real 3000 ms arXiv request-start pacing inside the aggregate deadline with deterministic tests.
- Reconciled migration and release guidance so 2026.07.28 and Phase 4 planning are current while Phase 2 records remain explicitly historical.
- The same independent verifier then returned PASS.

## Boundaries

- The live smoke proves only current bounded transport execution.
- Both approvals record local operator intent only, not authenticated organizational authority.
- `extraction_field`, mechanical observations, a draft blueprint, and construction intent do not prove semantic or domain quality.
- `enter-produce` does not authorize Phase 4 installation or Phase 5 execution.
- Package construction, ownership-safe installation, live OpenClaw execution, recovery, scheduling, memory/RAG, and domain evaluation remain later phases.

## Next

Begin Phase 4 by planning and implementing deterministic Agent Package generation from the exact approved build contract. Keep installation as a separately authorized mutation and stop before Phase 5 runtime execution.
