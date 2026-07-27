---
phase: 02-codex-builder
plan: "09"
subsystem: codex-builder-uat
tags: [codex-uat, value-blind-evidence, exact-digest-admission, packed-runtime, human-gate]
requires:
  - phase: 02-codex-builder
    plan: "08"
    provides: [receipt-bound installed hook bridge, checkpoint challenge observations, packed mechanism evaluator]
provides:
  - canonical agentmo.codex-uat.v1 candidate producer and validator
  - ordered digest-CAS journal for eleven fixed Codex scenarios
  - exact behavior-evaluator admission separate from mechanism evidence
  - packed runtime, syntax and clean-import closure for the UAT module
affects: [02-10-clean-host-uat, BLDR-01, BLDR-07, codex-builder-support-evidence]
tech-stack:
  added: []
  patterns: [exact external admission, checkpoint-derived hook evidence, inode-bound journal CAS, closed value-blind schema, non-transitive certification]
key-files:
  created:
    - src/builder-codex-uat.js
    - test/builder-codex-uat.test.js
    - .planning/phases/02-codex-builder/02-09-SUMMARY.md
  modified:
    - src/builder-behavior-eval.js
    - src/builder-package.js
    - src/cli.js
    - package.json
    - test/codex-builder-behavior.test.js
    - test/builder-packed-install.test.js
    - test/helpers/io-surface-inventory.js
    - test/artifact-surface-coverage.test.js
    - README.md
    - release/2026.07.17.md
key-decisions:
  - "The durable identity is exactly agentmo.codex-uat.v1 and contains only fixed enums, booleans and digests; prompts, payloads, transcripts, output, paths, environment and credentials have no schema slot."
  - "Begin publishes only to an absent path, record requires the exact prior run digest and fixed next scenario, and finalize requires eleven ordered passing results at another absent path."
  - "builder behavior keeps the existing nine-scenario fresh-process mechanism lane unchanged and exposes value-blind operator observations only through a separate exact candidate lane."
  - "A candidate and its evaluator report retain humanAdmissionRequired true, realCodexSessionVerified false, and every activation, host behavior, package, domain and production certification flag false."
  - "Callers cannot construct basis or scenario success in memory: basis and non-hook facts require canonical exact-digest external admissions, while hook scenarios are derived from an exact loaded checkpoint challenge."
  - "Journal replacement retains the admitted run and staged handles, validates and syncs a random exclusive no-follow stage, rechecks both exact identities, publishes with one atomic rename, and cleans up only a stage inode it created before publication."
  - "Connected admission reconstructs the canonical current-project consumer from scope, release and selector, requires exactly one matching ledger entry, and requires its canonical digest to equal the receipt binding; ledger-digest agreement alone grants no authority."
  - "The Plan 02-08 bridge remained byte-identical; Plan 02-09 only consumes its challenge-bound provenance contract."
patterns-established:
  - "Operator-observation route: exact external basis -> absent run -> exact external observation or checkpoint-derived ordered CAS records -> absent canonical candidate -> exact current receipt/state/host/launcher/hook-runner admission."
  - "Evidence separation: synthetic packed mechanism results and value-blind observation candidates never share a certification lane or promote one another."
requirements-completed: []
requirements-progressed: [BLDR-01, BLDR-07]
requirements-pending: [BLDR-01, BLDR-07]
coverage:
  - id: D1
    description: "The fixed eleven-scenario value-blind journal produces canonical agentmo.codex-uat.v1 candidate bytes only after exact ordered CAS completion."
    requirement: BLDR-07
    verification:
      - kind: unit
        ref: "test/builder-codex-uat.test.js#value-blind Codex UAT artifact"
        status: pass
    human_judgment: false
  - id: D2
    description: "Behavior evaluation exact-admits the current release, receipt, owner, canonical current-project consumer, project, host, launcher, hook runner, scenario and result bindings in a separate candidate lane."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/codex-builder-behavior.test.js#exact-admits one connected UAT candidate without merging it into mechanism evidence"
        status: pass
    human_judgment: true
    rationale: "The integration uses a packed runtime and fixed fake Codex transport; it does not verify a real session, while authenticated normal-trust clean-host evidence still requires Plan 02-10 human admission."
  - id: D3
    description: "The UAT module is included in the exact release inventory, syntax chain and clean packed import/CLI closure."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#admits one deterministic fixed runtime inventory and its complete packed import closure"
        status: pass
    human_judgment: false
  - id: D4
    description: "Raw/private fields, caller claims, stale bindings, synthetic producers, trust bypass and non-isolated evidence fail closed without broader certification."
    requirement: BLDR-07
    verification:
      - kind: unit
        ref: "test/builder-codex-uat.test.js#rejects raw/private fields, caller booleans, disconnected provenance and non-isolation"
        status: pass
      - kind: integration
        ref: "test/codex-builder-behavior.test.js#exact-admits one connected UAT candidate without merging it into mechanism evidence"
        status: pass
    human_judgment: false
duration: one TDD implementation and compatibility pass
completed: 2026-07-17
status: complete
---

# Phase 2 Plan 09: Value-blind Codex UAT Artifact Summary

**A canonical eleven-scenario value-blind operator-observation candidate can now be journaled, exact-admitted against the current installed chain, and kept strictly separate from real-session and certification claims.**

Primary implementation files: `src/builder-codex-uat.js` and `src/builder-behavior-eval.js`.

## Performance

- **Duration:** One TDD implementation, packed compatibility and full-suite pass
- **Started:** 2026-07-17
- **Completed:** 2026-07-17
- **Tasks:** 3
- **Files created or modified:** 12 implementation, test, surface-contract and documentation files

## Accomplishments

- Added the exact `agentmo.codex-uat.v1` identity with release, receipt, owner, consumer, project, host, auth, isolation, launcher, hook-runner, external-basis, scenario-set and ordered-result digest bindings.
- Added absent-output `begin`, exact prior-run-digest `record`, and complete-only absent-output `finalize` operations for the fixed eleven scenarios.
- Closed every persisted scenario to ID, pass/fail, before/after checkpoint digests, a bounded observation digest and fixed producer provenance. Non-hook scenarios require an exact external observation admission; hook scenarios are derived from an exact checkpoint challenge binding runner, release, receipt, event, scenario, challenge, before/after state and count. Raw prompts, payloads, transcripts, stdout/stderr, paths, environment and credentials are structurally impossible.
- Added public `builder codex-uat begin|record|finalize` commands with one-to-one digest bindings and bounded non-certifying output. `record` accepts exactly one external scenario artifact or one checkpoint challenge artifact.
- Replaced in-place truncate/restore with random `O_EXCL|O_NOFOLLOW` staging, complete write/sync/verification, retained prior-and-stage identity rechecks, one atomic rename, supported parent-directory sync and owned-stage-inode-only pre-publication cleanup. Stage write, sync and verification failures leave the prior bytes and inode unchanged; post-rename errors never restore or truncate the published next value.
- Added `builder behavior --uat` exact candidate admission against the pristine activated receipt, current owner/consumer state, current host observation, installed project-local launcher and installed hook-runner digest, while always returning `realCodexSessionVerified: false`.
- Closed the final consumer-membership gap: a valid ledger and matching ledger digest are rejected unless the ledger contains exactly one canonical entry rebuilt from the admitted project scope, current release and receipt selector, and that entry digest equals `consumerEntryDigest`.
- Preserved the prior `builder behavior-eval` nine-scenario fresh-process mechanism report unchanged and false for activation, host behavior, package, domain and production certification.
- Added the UAT module to the fixed 60-asset release inventory (55 runtime assets), explicit syntax checks and clean packed import/help closure.
- Synchronized the exact production I/O allowlist after source lines settled and retained Plan 02-09 ownership for all 18 UAT journal surfaces.
- Kept `src/builder-hook-bridge.js` unchanged at SHA-256 `d30feaf880decec310b0d576a056322aa462d935d4106596ee214df0f8b5f643`.

## TDD Evidence

- **Task 1 RED:** `node --test test/builder-codex-uat.test.js` failed 1/1 with `ERR_MODULE_NOT_FOUND` before the UAT module existed.
- **Task 1 GREEN:** `node --test test/builder-codex-uat.test.js` passed 7/7, including a complete CLI begin -> eleven records -> finalize route.
- **Task 2 RED:** `node --test test/codex-builder-behavior.test.js` passed 3/4; the new exact `builder behavior --uat` request was rejected by the old CLI contract.
- **Task 2 GREEN:** the packed behavior suite passed 4/4 with mechanism separation, exact current bindings, human and JSON output, wrong digest, stale release/receipt/owner/consumer/project/host/launcher and caller-claim rejection.
- **Task 3 RED:** the packed inventory test failed 0/1 because `package.json` did not yet syntax-check `src/builder-codex-uat.js`.
- **Task 3 GREEN:** the packed inventory/import/help test passed 1/1 and the complete packed suite passed 12/12.
- **Independent review RED:** two new security regressions failed 0/2: caller-built provenance could still enter candidate construction, and predictable journal staging did not preserve foreign stage/late-swapped run identities.
- **Independent review GREEN:** the exact-admission/checkpoint-derivation and retained-handle CAS regressions passed 2/2; the complete UAT suite then passed 9/9.
- **Authority/crash-safety follow-up RED:** the value-blind fixtures were rejected by the older official/authenticated provenance contract, and the new stage write/sync/verify seams were absent; the two focused suites failed 9/13.
- **Authority/crash-safety follow-up GREEN:** all caller-writable provenance is now bounded as operator-reported, every real-session/certification flag is false, and six CAS adversarial modes plus canonical inode-replacing success pass; the two focused suites pass 13/13.
- **Consumer-membership P2 RED/GREEN:** a canonical rewritten ledger and receipt with matching digests but no current-project consumer incorrectly passed the old evaluator; missing, scope-mismatched and release-mismatched consumer cases now fail closed, and the behavior suite passes 5/5.

## Final Verification

- `node --test test/builder-codex-uat.test.js test/codex-builder-behavior.test.js test/builder-packed-install.test.js test/artifact-surface-coverage.test.js` — **PASS, 36/36 across 4 suites**.
- Post-review affected subset (`builder-codex-uat`, `codex-builder-behavior`, `artifact-surface-coverage`) — **PASS, 24/24 across 3 suites**.
- `node --test test/builder-packed-install.test.js` — **PASS, 12/12**.
- `npm run check` — **PASS, 616/616 across 66 suites**; the environment-specific actual Node 20 lane remained an expected skip record.
- `npm pack --dry-run --json --cache /tmp/agentmo-npm-cache-02-09-consumer-p2` — **PASS, 61 entries**, shasum `de60417cce05bc02699b70fc52b1cf0f9386395d`, integrity `sha512-BfKLwC8f9tymCDFHQtlsVLpnWP1tX0ri3EvrMiyLnQvtSP/F4RYKSbJLp9paC9B4eD6QbKmE+2tIfQ01IOSl0g==`.
- `git diff --check` — **PASS**.

## Files Created/Modified

- `src/builder-codex-uat.js` — closed schema, exact external/checkpoint loaders, retained-handle identity-bound journal CAS and absent publication.
- `src/builder-behavior-eval.js` — separate connected-candidate admission while retaining mechanism evaluation.
- `src/cli.js` — UAT journal commands and exact `builder behavior --uat` route.
- `src/builder-package.js`, `package.json` — fixed runtime inventory and explicit syntax closure.
- `test/builder-codex-uat.test.js` — schema, CAS, value-blind, provenance and CLI matrix.
- `test/codex-builder-behavior.test.js` — packed exact candidate admission and stale-binding matrix.
- `test/builder-packed-install.test.js` — exact asset membership, syntax, import and help closure.
- `test/helpers/io-surface-inventory.js`, `test/artifact-surface-coverage.test.js` — exact Plan 02-09 I/O ownership.
- `README.md`, `release/2026.07.17.md` — public evidence boundary and release record.

## Decisions Made

- Kept candidate construction deliberately non-self-certifying: complete canonical bytes still carry `humanAdmissionRequired: true` and all certification flags false.
- Required evaluator agreement with current external installation/state/host/launcher evidence for machine-checkable bindings. Auth, trust and launch-isolation provenance remain reported operator facts for the Plan 02-10 human gate and cannot upgrade the candidate to real-session evidence.
- Kept the original behavior evaluator as a compatibility alias and mechanism lane; the new `behavior --uat` route returns a different bounded report without embedded mechanism scenarios.
- Used no new dependency, external call, source checkout or global launcher.

## Deviations from Plan

### Auto-fixed Issues

1. Adding the UAT import to the CLI made the package import-closure guard reject the module until it entered the canonical runtime inventory. The inventory was added early so Task 2 packed RED could isolate the intended missing CLI route; Task 3 then closed syntax and packed assertions.
2. Final review found the human formatter still assumed the mechanism report's `scenarios` field. A separate bounded UAT formatter and packed human-CLI regression were added; evidence semantics did not change.
3. New public CLI and evaluator lines shifted the exact repository I/O identities. Existing rows were moved without changing ownership, and all 18 UAT journal surfaces were assigned to Phase 02 Plan 09.
4. Independent security review reproduced caller-built provenance admission and predictable-temp/pathname CAS races. Public construction now requires exact admissions, hook results are checkpoint-derived, and journal publication binds retained handles and owned inodes; the bridge remained unchanged.
5. Follow-up authority and crash-safety review found that exact-digest caller artifacts still used official/authenticated vocabulary and that in-place truncation could expose partial bytes before restoration. Persisted/returned authority was honestly downgraded to a value-blind operator-observation candidate, `realCodexSessionVerified` is strictly false, and CAS publication now stages then atomically renames without mutating prior bytes on pre-publication failure.
6. Final P2 review found that evaluator agreement with the whole ledger digest did not prove membership of the current project. Admission now rebuilds and digests the canonical consumer entry and rejects a missing or mismatched entry even when ledger, receipt and UAT digests agree.

**Total deviations:** 6 compatibility, repository-contract, authority and security fixes. None expands evidence authority.

## Evidence Boundary

This plan proves the formal value-blind candidate mechanism, exact installed-chain binding checks and packed availability. Its connected integration uses a controlled fake Codex host; no authenticated real Codex session was run or verified. Caller artifacts can report normal trust and authentication only as operator observations. The candidate does not certify activation, host behavior, Agent Package quality, domain quality, production readiness, deployment approval or wider Codex compatibility. BLDR-01 and BLDR-07 remain pending until Plan 02-10 admits the clean-host normal-trust run through the human gate.

## Commits

None — the user did not authorize staging or commits.

## User Setup Required

None for this plan. The clean-host Codex session and human admission are Plan 02-10 work.

## Next Phase Readiness

Plan 02-10 can perform the real isolated Codex session, bind its independently reviewed evidence through the now-packed commands, and perform the human support gate. Phase 2 and BLDR-01/BLDR-07 remain open until that evidence exists.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-17*

## Self-Check

PASS — summary artifacts and final verification evidence are present.
