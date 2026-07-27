---
phase: 3
slug: build-contract
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-27
---

# Phase 3 — Validation Strategy

> Phase 3 uses focused Node contract tests after each task, bounded integration tests after each wave, and one full repository check at the phase gate.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node built-in `node:test` on Node `>=20` |
| **Config file** | none |
| **Quick run command** | `node --test test/discovery-live.test.js test/discovery-live-security.test.js` |
| **Full suite command** | `npm run check` |
| **Estimated runtime** | focused tests under 10 seconds; aggregate may take about 21 minutes |

## Sampling Rate

- **After every task:** Run the task's focused test file plus `git diff --check`.
- **After every plan wave:** Run the Stage 1 or Stage 2 contract set affected by that wave.
- **Before `$gsd-verify-work`:** Run `npm run check`, `git diff --check`, one separately labelled bounded live smoke, and exact approval replay.
- **Max focused feedback latency:** 30 seconds.

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 3-01 | 01 | 1 | DISC-01..04 | T3-01..06 | Bounded HTTPS allowlist retrieval publishes only preflighted records | contract + security | `node --test test/discovery-live.test.js test/discovery-live-security.test.js` | ❌ W0 | ⬜ pending |
| 3-02 | 02 | 2 | DISC-03..05 | T3-02..06 | Provider metadata remains distinct from trust and semantic quality | unit | `node --test test/discovery-live.test.js test/design-plan.test.js` | ❌ W0 | ⬜ pending |
| 3-03 | 03 | 3 | DISC-06, PLAN-01 | T3-07 | Approval binds exact manifest and derived DB bytes | contract | `node --test test/discovery-approval.test.js test/phase3-contracts.test.js` | ❌ W0 | ⬜ pending |
| 3-04 | 04 | 4 | PLAN-02..03 | T3-08 | Typed decisions and trace edges reject transcripts and dangling refs | contract + security | `node --test test/decision-ledger.test.js test/build-contract.test.js` | ❌ W0 | ⬜ pending |
| 3-05 | 05 | 5 | PLAN-04..05 | T3-09 | OpenClaw resource graph and final approval are complete and exact-bound | contract | `node --test test/build-contract.test.js test/openclaw-build-contract.test.js test/openclaw-resource-projection.test.js` | ❌ W0 | ⬜ pending |
| 3-06 | 06 | 6 | all | T3-01..09 | Public CLI composes without Phase 4 mutation or transitive certification | integration | `node --test test/phase3-contracts.test.js test/stage-contracts.test.js` | ❌ W0 | ⬜ pending |

## Wave 0 Requirements

- [ ] `test/discovery-live.test.js`
- [ ] `test/discovery-live-security.test.js`
- [ ] `test/discovery-approval.test.js`
- [ ] `test/decision-ledger.test.js`
- [ ] `test/build-contract.test.js`
- [ ] `test/openclaw-build-contract.test.js`
- [ ] `test/openclaw-resource-projection.test.js`
- [ ] `test/phase3-contracts.test.js`

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Bounded public HTTPS retrieval against an approved source | DISC-01..04 | Unit tests inject transport and must not certify current Internet behavior | Run the documented live smoke with a fixed public allowlist and verify exact digests, bounded metadata, zero raw payload persistence, and explicit non-domain certification. |
| Human approval meaning | DISC-06, PLAN-05 | A process cannot self-certify human intent | Independently inspect the exact manifest/DB or blueprint/build-contract digest pair, approve through the public command, then prove byte mutation invalidates that approval. |

## Validation Sign-Off

- [x] Every planned behavior has a focused automated test or an explicit Wave 0 dependency.
- [x] No three consecutive tasks lack automated verification.
- [x] Full commands avoid watch mode.
- [x] OpenClaw resource completeness covers prompt, skills, tools, plugins, memory/RAG, storage, schedules, harness, loop, permissions, installation, recovery, and evidence.
- [ ] Wave 0 test files exist.
- [ ] Full suite is green.

**Approval:** pending
