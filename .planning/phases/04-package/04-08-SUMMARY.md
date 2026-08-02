---
phase: 04-package
plan: "08"
subsystem: openclaw-lifecycle-authority-cli
tags: [openclaw, fresh-process, exact-admission, d42-archive, create-only]
requires:
  - phase: 04-package
    plan: "07"
    provides: Create-only authority writers and the registered exact install-receipt descriptor
provides:
  - Receipt-first registration of five lifecycle authority descriptors and public contracts
  - Fresh-process verified-genesis and four-action archive-only preview CLI routes
  - One-review publication of independent ordinary, per-sensitive-action, and exact-conflict authorities
affects: [04-09-install-transaction, 04-10-install-evidence, phase-5-runtime]
tech-stack:
  added: []
  patterns:
    - Exact subject/file/external-digest admission before lifecycle model construction
    - Mutually exclusive absent-genesis and receipt predecessor bases
    - Complete D-42 archive revalidation before durable successor publication
key-files:
  created:
    - release/2026.07.30.md
    - .planning/phases/04-package/04-08-SUMMARY.md
  modified:
    - src/artifact-contract.js
    - src/artifact-registry.js
    - src/artifact-subjects.js
    - src/cli.js
    - test/artifact-admission.test.js
    - test/openclaw-install-plan.test.js
    - test/openclaw-install-approval.test.js
    - test/phase4-contracts.test.js
key-decisions:
  - "Lifecycle CLI accepts only exact canonical request/probe files plus the deterministic D-42 archive; package roots, manifest-only input, force, purge, MCP, and effect flags remain unsupported."
  - "Install exact-admits verified absent genesis and rejects receipt substitution; upgrade/uninstall exact-admit one current receipt; rollback exact-admits current and selected predecessor receipts plus the selected predecessor archive."
  - "Approval exact-admits one plan and publishes ordinary, every sensitive action, and the entire conflict set as non-interchangeable create-only files."
patterns-established:
  - "Receipt-first registry order: install receipt precedes absent genesis, plan, ordinary approval, sensitive decision, and conflict approval."
  - "Fresh-process handoff: every authority is reloaded from caller-selected bytes and external SHA-256; same-process objects are not CLI authority."
requirements-completed: [OCLW-02, OCLW-04, EVID-05]
coverage:
  - id: D1
    description: "Five lifecycle authority contracts and descriptors are registered after the retained receipt descriptor and are independently exact-admissible."
    requirement: EVID-05
    verification:
      - kind: integration
        ref: "test/artifact-admission.test.js#fresh processes expose all five lifecycle authority contracts after receipt registration"
        status: pass
      - kind: unit
        ref: "test/phase4-contracts.test.js#Phase 4 Wave 8 registers receipt before every fresh-process lifecycle authority"
        status: pass
    human_judgment: false
  - id: D2
    description: "Fresh install, upgrade, uninstall, and rollback previews revalidate the complete archive and exact action-specific genesis/receipt bases before publishing one plan."
    requirement: OCLW-02
    verification:
      - kind: integration
        ref: "test/openclaw-install-plan.test.js#fresh processes capture exact genesis and publish one archive-only install preview"
        status: pass
      - kind: integration
        ref: "test/openclaw-install-plan.test.js#fresh upgrade, uninstall, and rollback previews exact-admit receipt file/digest bases"
        status: pass
    human_judgment: false
  - id: D3
    description: "One fresh approval process publishes independent ordinary, per-action, and exact-conflict authorities that a second process exact-admits."
    requirement: OCLW-04
    verification:
      - kind: integration
        ref: "test/openclaw-install-approval.test.js#a fresh approval process publishes independently exact-admissible authority files"
        status: pass
    human_judgment: false
duration: 15min
completed: 2026-07-30
status: complete
---

# Phase 4 Plan 8: Fresh-Process Lifecycle Authority CLI Summary

**Receipt-aware genesis, four-action D-42 preview, and independent approval authorities now cross fresh process boundaries through exact file and external-digest admission without adding any lifecycle effect**

## Performance

- **Duration:** 15 min
- **Started:** 2026-07-30T02:17:00Z
- **Completed:** 2026-07-30T02:31:29Z
- **Tasks:** 2/2
- **Files created/modified:** 10

## Accomplishments

- Preserved `openclaw-install-receipt` as the first lifecycle descriptor and registered the five absent-genesis/plan/approval authority families with closed public contracts and exact subjects.
- Added fresh-process `openclaw-install-genesis`, `openclaw-install-preview`, and `openclaw-install-approve` routes with strict mutually exclusive lifecycle bases and absent-file publication.
- Revalidated caller-supplied archive SHA-256 plus manifest, inventory, complete member set, type, mode, byte length, member digest, and predecessor archive correspondence before plan output.
- Proved a second process can exact-admit every produced authority under the correct subject while stale digest, byte drift, missing mate, duplicate/substituted basis, and recomputed-outer-digest internal archive attacks create no successor.

## Task Results

### Task 1: Write failing fresh-process receipt/genesis preview and approval journeys

- RED ran the required four-file gate and produced exactly two expected failures: the five descriptors/contracts were absent and Wave 8 command subjects were unsupported.
- Existing Wave 6/7 model, writer, receipt, and Phase 4 tests remained green: 36 passed while the two new Wave 8 tests failed.
- The expanded journey tests cover install genesis, upgrade/uninstall current receipt, rollback current plus selected predecessor receipt/archive, independent approval publication, fresh exact admission, and internal D-42 mutation.

### Task 2: Register and wire archive-only fresh-process lifecycle producers

- Registry order is `receipt -> absent genesis -> plan -> ordinary -> sensitive -> conflict`; descriptor indexes were observed as `15,16,17,18,19,20`.
- Genesis and request/probe intake use retained bounded no-follow exact reads. Receipt and plan authorities use the central subject/file/external-digest artifact admission path.
- Preview rebuilds archive binding only from the exact D-42 reader and admits exactly one action-specific basis before calling the pure model or writer.
- Approval builds one frozen plan review into independent ordinary, one-per-action, and exact-conflict candidates, then uses the Plan 04-07 whole-set absent preflight and create-only writers.

## Verification

| Gate | Result |
| --- | --- |
| RED required gate | expected failure: 36 pass, 2 fail for missing Wave 8 descriptors/subjects |
| Final required gate: artifact admission + install plan + approval + Phase 4 contracts | 41 pass, 0 fail |
| Bounded adjacent artifact-contract + artifact-subjects + CLI gate | 39 pass, 0 fail |
| `node --check` on four production and four focused test files | pass |
| Global `git diff --check` | pass |
| Receipt-first registry-order probe | pass: indexes `15,16,17,18,19,20` |
| Stub/trailing-whitespace scan | pass: no blocking stubs or trailing whitespace |

The full `npm run check` was intentionally not run because this Wave explicitly requires the bounded four-file final gate.

## Certification Boundary

This plan proves bounded fresh-process authority transport, exact admission, complete archive revalidation, deterministic proposal construction, and independent create-only approval publication only.

It does not add or certify:

- an install receipt writer, transaction journal, receipt-last commit, apply route, install, upgrade, rollback, uninstall, activation, or target mutation;
- an OpenClaw process, plugin load, MCP connection, credential route, agent invocation, or schedule execution;
- runtime behavior, domain quality, Birth, Delivery, wider OpenClaw compatibility, production readiness, publication, or deployment.

The admitted probe remains separate bounded read-only capability evidence. These CLI routes do not upgrade its claims or turn a proposal/approval file into completed lifecycle evidence.

## Decisions Made

- Kept generated lifecycle contracts directly addressable through `artifact-contract <subject>` while excluding lifecycle-produced evidence from the existing operator-authored subject listing.
- Used exact canonical request files only for explicit target/operation/review facts; durable authority always comes from registered subject bytes and caller-supplied external digests.
- Derived receipt plan provenance from the exact admitted receipt digest and its closed target/archive/ownership fields rather than accepting parsed objects or embedded receipt claims.
- Retained approval-family independence all the way through output paths, digests, registry validators, and second-process admission.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

- The broader `test/artifact-surface-coverage.test.js` fixed line-number inventory is stale across the shared dirty Wave 1-8 worktree and reports earlier Wave surfaces plus current CLI line shifts. It is outside Plan 04-08's declared files and bounded gate; no inventory rewrite was made. The directly relevant artifact-contract, subject, CLI, required Wave 8, syntax, and diff gates all pass.

## AGENTS.md-Driven Adjustments

- Added `release/2026.07.30.md` because this plan changes public lifecycle authority and certification-boundary semantics.
- Ran only the required Wave 8 gate and bounded adjacent contract/subject/CLI checks, not the full npm suite.
- Did not read `.env`, credentials, sessions, raw provider payloads, raw transcripts, or unredacted target process output.
- Did not stage, commit, push, stash, reset, checkout, switch, or modify `.planning/STATE.md`, `.planning/ROADMAP.md`, or `.planning/REQUIREMENTS.md`.

## Known Stubs

None. Receipt writing, transaction journaling, apply/install effects, activation, and runtime evidence remain deliberately absent later-plan responsibilities, not incomplete Plan 04-08 stubs.

## Threat Review

- T-04-28: exact registered subject plus caller-selected file and external SHA-256 rejects subject swaps, wrong files, stale digests, byte mutation, missing mates, duplicate inputs, and lifecycle-basis substitution.
- T-04-29: retained D-42 reads recompute the outer/archive, manifest, inventory, full member, type, mode, byte-length, digest, and selected predecessor archive closure before successor publication.
- T-04-30: ordinary, each sensitive action, and the complete exact-conflict set retain different descriptors, schemas, paths, digests, and second-process admissions.
- T-04-31: plan target facts must exactly match the admitted probe fingerprint, target version, and source revision; stale or substituted facts fail before plan output.
- No unplanned network endpoint, authentication path, database/schema boundary, external process execution, or target mutation surface was introduced.

## Git Status

No commits were created. This execution obeyed the explicit prohibition on staging, committing, pushing, stashing, resetting, checkout, or switch.

## Next Phase Readiness

- Plan 04-09 can consume exact plan and approval files plus the already registered receipt descriptor to implement transaction journaling and receipt-last publication.
- No later plan may treat preview or approval as installed state, reuse a prior receipt without its exact external digest, or bypass D-42 revalidation.

## Self-Check: PASSED

- All four planned production files, four planned test files, the current-date release record, and this summary exist.
- Receipt registration precedes all five lifecycle descriptors; public contracts and action-specific subjects resolve.
- The required final gate passed 41/41 and the directly relevant adjacent gate passed 39/39.
- Syntax checks, global `git diff --check`, registry-order, stub, and threat-surface checks passed.
- No receipt writer, transaction journal, apply/install route, target mutation, OpenClaw execution, credential route, MCP connection, or runtime certification was added.
- Commit verification is not applicable because Git writes were explicitly prohibited.
