---
phase: 04
slug: package
status: draft
nyquist_compliant: true
wave_0_complete: false
bootstrap_strategy: per-wave-red-first
created: 2026-07-28
updated: 2026-07-30
---

# Phase 04 — Validation Strategy

> Phase 4 uses an honest per-wave RED-first strategy. Plan 04-01 creates the incremental phase gate; each later plan creates and observes its focused RED tests before production behavior. There is no fictional pre-execution Wave 0 that creates every future test.

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` |
| **Config file** | none |
| **Quick run command** | Plan 04-01: package/carrier/phase-contract trio; Plans 04-02..19: `node --test test/phase4-contracts.test.js` plus each plan's focused tests |
| **Full suite command** | `npm run check` |
| **Estimated runtime** | quick gate ≤60 seconds; full suite contains known long Builder recovery matrices and must report the actual unbounded or explicitly bounded outcome |

## Sampling Rate

- **After every task:** run the task's focused `node --test ...` command.
- **After Plan 04-01:** run the package/carrier/phase-contract bootstrap trio.
- **After Plans 04-02..19:** run `test/phase4-contracts.test.js` plus that plan's focused tests.
- **Before `$gsd-verify-work`:** `npm run check` and `git diff --check` must complete successfully; a timeout/interruption is inconclusive, never green.
- **Max quick feedback latency:** 60 seconds.

## Per-Plan Verification Map

| Plan | Wave | Requirements | Secure behavior | Automated command | Introduction |
|------|------|--------------|-----------------|-------------------|--------------|
| 04-01 | 1 | PACK-01, PACK-02, PACK-03, PACK-04, EVID-05 | Closed package schema, lowest-trust carrier gate, executable inventory and incremental phase boundary | `node --test test/package-contract.test.js test/package-carriers.test.js test/phase4-contracts.test.js` | RED-first in 04-01 |
| 04-02 | 2 | PACK-02, PACK-03, PACK-04, OCLW-01, EVID-05 | Phase 3-reapproved canonical native-plugin recipe/content plus exact target/carrier admission; no pre-existing implementation path | `node --test test/package-contract.test.js test/package-carriers.test.js test/openclaw-build-contract.test.js test/openclaw-target-admission.test.js test/phase4-contracts.test.js` | RED-first before checkpoint |
| 04-03 | 3 | PACK-01, PACK-02, PACK-03, PACK-04 | Recipe-only native-plugin byte generation, deterministic executable directory/archive and complete OpenClaw projection | `node --test test/package-contract.test.js test/package-carriers.test.js test/openclaw-build-contract.test.js test/openclaw-target-admission.test.js test/package-produce.test.js test/package-determinism.test.js test/openclaw-package.test.js test/phase4-contracts.test.js` | RED-first in 04-03 |
| 04-04 | 4 | PACK-01, PACK-02, PACK-05, EVID-05 | Offline human/JSON inspect, complete archive closure and value-blind public artifact admission | `node --test test/package-contract.test.js test/package-produce.test.js test/package-determinism.test.js test/package-inspect.test.js test/artifact-admission.test.js test/artifact-contract.test.js test/phase4-contracts.test.js` | RED-first in 04-04 |
| 04-05 | 5 | OCLW-01, OCLW-05 | Direct-FS/synthetic-state read-only probe and normalized drift fingerprint | `node --test test/package-inspect.test.js test/openclaw-probe.test.js test/phase4-contracts.test.js` | RED-first in 04-05 |
| 04-06 | 6 | OCLW-02, OCLW-04, EVID-05 | Archive-bound install/upgrade/rollback/uninstall models and ordinary/sensitive/conflict approval services | `node --test test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js test/phase4-contracts.test.js` | RED-first in 04-06 |
| 04-07 | 7 | OCLW-02, OCLW-03, OCLW-04, EVID-05 | Receipt identity/admission and create-only genesis/plan/approval writers | `node --test test/artifact-admission.test.js test/artifact-contract.test.js test/artifact-subjects.test.js test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js test/phase4-contracts.test.js` | RED-first in 04-07 |
| 04-08 | 8 | OCLW-02, OCLW-04, EVID-05 | Closed registry/subjects plus fresh-process CLI produce→external digest→exact re-admit chain | `node --test test/artifact-admission.test.js test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js test/phase4-contracts.test.js` | RED-first in 04-08 |
| 04-09 | 9 | OCLW-03, OCLW-04, OCLW-05, EVID-05 | Receipt-last lifecycle apply, prior receipt/absent genesis, retained identity, preserve-on-conflict and archive-member drift rejection | `node --test test/artifact-admission.test.js test/openclaw-install-plan.test.js test/openclaw-install-approval.test.js test/openclaw-install-transaction.test.js test/phase4-contracts.test.js` | RED-first in 04-09 |
| 04-10 | 10 | all Phase 4 requirements | Packed Builder inventory, public surface coverage and declared package/install regression | `node --test test/builder-packed-install.test.js test/artifact-surface-coverage.test.js test/stage-contracts.test.js test/phase4-contracts.test.js` | RED-first packed assertions |
| 04-11 | 11 | all Phase 4 requirements | Operator/release contract and final focused, Stage 2/3/4, full-suite and diff gates | focused commands from plan, then `npm run check` and `git diff --check` | final closure |
| 04-12 | 12 | OCLW-01, OCLW-02, EVID-05 | Mandatory companion-backed fresh reprobe, private executable/cwd and full fingerprint drift rejection | `node --test test/openclaw-probe.test.js test/openclaw-install-transaction.test.js test/artifact-admission.test.js test/phase4-contracts.test.js` | gap RED-first |
| 04-13 | 13 | OCLW-02, OCLW-04, OCLW-05, EVID-05 | retained-dirfd no-replace kernel, durable build receipt, explicit helper admission and no fallback | `node --test test/openclaw-safe-fs.test.js test/openclaw-install-transaction.test.js test/cli.test.js` | focused gap RED-first; packed journey belongs to 04-18 |
| 04-14 | 14 | OCLW-02, OCLW-05, EVID-05 | per-authority/per-nonce O_EXCL markers, marker/parent fsync, double-writer/crash/partial-marker replay rejection | `node --test test/openclaw-install-approval.test.js test/openclaw-install-transaction.test.js test/phase4-contracts.test.js` | gap RED-first |
| 04-15 | 15 | OCLW-02, OCLW-03, OCLW-04, OCLW-05, EVID-05 | observed genesis and real install/upgrade/rollback/uninstall official-route effects | `node --test test/openclaw-install-plan.test.js test/openclaw-install-transaction.test.js test/openclaw-credential-handoff.test.js test/phase4-contracts.test.js` | gap RED-first |
| 04-16 | 16 | OCLW-03, OCLW-04, EVID-05 | strict receipt completion theorem and exact authority/result ledger | `node --test test/openclaw-install-transaction.test.js test/artifact-admission.test.js test/artifact-contract.test.js test/phase4-contracts.test.js` | gap RED-first |
| 04-17 | 14 | PACK-03, PACK-04, OCLW-04, EVID-05 | identity-safe publishers, nested recipe paths and canonical MVP goal metadata | `node --test test/package-produce.test.js test/openclaw-target-admission.test.js test/openclaw-target-descriptor.test.js test/openclaw-package.test.js` | gap RED-first |
| 04-18 | 17 | all Phase 4 requirements | exact packed inventory plus extracted-tarball helper build/admit/public-apply and full lifecycle/adversarial closure | `node --test test/builder-packed-install.test.js test/artifact-surface-coverage.test.js test/phase4-contracts.test.js` | sole owner of packed build/admit/apply regression |
| 04-19 | 18 | all Phase 4 requirements | docs/release, focused/full/pack/diff gates and noncanonical pre-verification audit | focused commands from plan, then `npm run check`, `npm pack --dry-run`, `git diff --check` | pre-verification only |

## Planned RED-First Bootstrap

- [ ] Plan 04-01 creates `test/package-contract.test.js`, `test/package-carriers.test.js`, and incremental `test/phase4-contracts.test.js`.
- [ ] Plan 04-02 creates/extends `test/openclaw-build-contract.test.js` and creates `test/openclaw-target-admission.test.js` before the human recipe/target/carrier checkpoint.
- [ ] Plans 04-03..09 create their focused tests before production behavior and extend the phase gate.
- [ ] Plans 04-10/11 extend initial packed, public-surface, stage and final regression coverage.
- [ ] Plans 04-12..17 add focused RED-first closure for all six root gaps, CR-01..10 and WR-01..03.
- [ ] Plan 04-18 proves packed runtime closure; Plan 04-19 runs docs/full gates and a noncanonical pre-verification audit.
- [ ] Exact-version OpenClaw target or a newly approved Phase 3 contract remains a blocking execution checkpoint before real apply.

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Exact target/version and hook carrier gate | PACK-02, PACK-03, PACK-04, OCLW-01 | The approved Phase 3 contract targets OpenClaw `2026.6.11`, while the installed CLI reports `2026.7.1-2`; the current contract also lacks an approved typed-hook owner and canonical byte recipe | Reapprove a Phase 3 build contract containing the complete canonical native-plugin recipe/content without a pre-existing plugin file, provide the exact approved target, then approve the resulting target/carrier admission artifact and recipe digest |
| Human install review | OCLW-02, EVID-05 | Automated tests cannot substitute for the operator's actual decisions | Review the one-screen plan, independently select sensitive actions, approve the exact conflict set, verify archive/manifest/inventory/fingerprint bindings and rollback scope, then approve the exact preview digest |

## Validation Sign-Off

- [x] All 19 plans have an automated RED-first, regression, or pre-verification mapping.
- [x] Sampling continuity prevents three consecutive tasks without automated verification.
- [x] Target-admission coverage is explicitly mapped to Plan 04-02.
- [x] Receipt identity/admission precedes lifecycle apply.
- [x] No watch-mode flags.
- [x] Quick feedback target is under 60 seconds.
- [x] `nyquist_compliant: true` is set.
- [ ] `wave_0_complete` remains false because tests are execution work, not planning artifacts.

**Approval:** pending gap-plan checker, execution, 04-19 SUMMARY, then execute-phase canonical review/verifier post gate
