---
phase: 02-codex-builder
verified: 2026-07-20T16:04:54Z
status: gaps_found
score: "1/5 roadmap must-haves verified"
plan_score: "41/73 plan truths verified"
requirements_score: "3/8 requirements satisfied"
behavior_unverified: 0
overrides_applied: 0
mvp_user_story_valid: false
next_command: "/gsd:plan-phase 02 --gaps"
re_verification:
  previous_status: gaps_found
  previous_score: "15/39 plan must-haves verified"
  gaps_closed:
    - "Complete-or-reject ESM closure, non-literal I/O inventory, and artifact-surface coverage were added and pass their regression tests."
    - "Lifecycle retirement now retains exact handles through its intended commit path; the prior lifecycle-specific validate-then-unlink finding is no longer present in the latest review."
    - "Doctor path-identity and packed-loader coverage were strengthened; the latest review contains no doctor-specific blocker."
  gaps_remaining:
    - "A packed release still cannot complete the clean-host setup/activation/UAT flow: the sole real attempt failed during setup apply."
    - "UAT transition and human-decision authority remain caller-forgeable."
    - "Project publication, shared host state, and host owner/ledger transactions remain vulnerable to replacement and rollback failures."
    - "Immutable-journal cleanup and commit reporting remain unsafe under final-window replacement/failure."
  regressions: []
gaps:
  - truth: "A packed release can be installed and activated on a clean Codex host with exact ownership and rollback."
    status: failed
    reason: "The only real UAT failed closed at setup apply with AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED. CR-03 through CR-06 show that already-published project files, staging-path publication, shared state-root trust, and host owner/ledger CAS are not transactionally safe."
    artifacts:
      - path: "src/builder-install.js"
        issue: "Published project files can remain without a receipt after host failure, and publication links a staging pathname after its handle is closed."
      - path: "src/builder-codex-host.js"
        issue: "Shared authority roots lack uid/mode checks; owner/ledger restore and retract operations still act on replaceable pathnames."
    missing:
      - "Rollback or durable recovery authority for every project file published before receipt commit."
      - "Retained-handle or otherwise race-safe project and host-state publication/retraction."
      - "Owner-only, non-group/world-writable validation for every shared authority directory."
      - "Focused final-window and partial-publication regressions before any new real UAT."
  - truth: "Only the real packed verifier and installed workflow can advance UAT evidence or append a human decision."
    status: failed
    reason: "CR-01 exposes a generic append API that can fabricate all pre-candidate UAT transitions. CR-02 exposes inspection/decision APIs that accept caller-provided verifier evidence and can append a human admission without executing the packed verifier."
    artifacts:
      - path: "src/builder-codex-uat.js"
        issue: "appendCodexUatAttemptEntry, inspectCodexUatCandidateForHumanDecision, and decideCodexUatCandidate export excessive authority."
      - path: "src/cli.js"
        issue: "Production CLI paths consume the generic append primitive instead of closed per-transition operations."
      - path: "scripts/verify-codex-uat-candidate.js"
        issue: "The intended verifier uses the public APIs, but importing the module directly bypasses verifier execution."
    missing:
      - "Module-private generic append and narrow transition operations that derive evidence from exact artifacts."
      - "A non-forgeable verifier admission minted only by a successful packed self-check."
      - "Negative direct-import/child-process tests proving synthetic histories and decisions are rejected."
  - truth: "Pause, compaction, restart, duplicate replay, and recovery evidence remain exact and readable across failures and pathname replacement."
    status: failed
    reason: "CR-07 allows immutable-journal cleanup to unlink a foreign final-window replacement. CR-08 can report failure after an entry is durably committed and leave lock/stage state that prevents later reads."
    artifacts:
      - path: "src/builder-immutable-journal.js"
        issue: "removeOwnedPath is lstat-then-unlink by pathname; cleanup failure after durable append is surfaced as an operation failure without a recoverable commit result."
    missing:
      - "Identity-safe cleanup that cannot unlink a pathname replacement."
      - "A commit/recovery contract that distinguishes durable success from cleanup failure and leaves the chain readable."
      - "Final-window replacement and post-commit cleanup-failure regression tests."
---

# Phase 2: Codex Builder Verification Report

**Phase Goal:** 开发者可以从打包产物在干净 Codex 环境中安装并运行 AgentMo Builder，在暂停、压缩、重启、升级或卸载前后保持工作流可恢复且资产归属可证明。

**Verified:** 2026-07-20T16:04:54Z
**Status:** `gaps_found`
**Re-verification:** Yes — after all 17 plans were executed
**Verdict:** The phase goal is not achieved. The mechanism suite passes, but the clean-host user outcome failed in the only real attempt and the latest review identifies eight code-level blockers in the authority, transaction, and recovery boundaries.

## Escalation Gate

ROADMAP marks Phase 2 as `mode: mvp`, but the goal fails the canonical MVP user-story validator (`user-story.validate` returned `false`). A formally valid MVP User Flow Coverage judgment therefore cannot be emitted. This report continues only as a conservative goal-backward technical re-verification so the observable blockers are not hidden. Passing the phase would require both gap closure and a developer decision to normalize the goal through `/gsd:mvp-phase 2` or remove the inconsistent MVP marker.

## User Flow Coverage

Because the MVP format guard failed, this table is a technical decomposition of the existing goal, not a valid user-story certification.

| Step | Expected outcome | Codebase/runtime evidence | Status |
| --- | --- | --- | --- |
| Obtain packed Builder release | Release contains the runtime closure, plugin, skills, agents, hooks, verifier, and manifests without a source checkout | Package/closure and artifact-surface tests pass; Plan 02-17 built verifier-inclusive disposable releases | VERIFIED (mechanism) |
| Install on a clean Codex host | Setup publishes exact assets, records ownership, activates host state, and can roll back safely | Sole real attempt failed at setup apply; CR-03 through CR-06 invalidate transaction and host-authority safety | FAILED |
| Start the installed Builder | A fresh Codex process observes trust/auth, SessionStart, and installed Builder entry | No activation or Codex process start occurred | FAILED |
| Recover through interruption and replay | Pause/compact/restart/duplicate flows resume exactly once from durable evidence | Synthetic tests pass, but CR-07/CR-08 invalidate final-window cleanup and durable-commit recovery; no real scenario ran | FAILED |
| Upgrade/uninstall with proven ownership | Only exact AgentMo-owned assets change; foreign and modified state is preserved | Lifecycle tests pass, but the install/host ownership substrate remains unsafe under CR-03 through CR-07 | FAILED |

## Goal Achievement

### Roadmap Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A packed release installs and exposes the plugin, skills, agents, and hooks in a clean Codex environment without source checkout | FAILED | Packaging is substantive, but the only real clean-host setup failed before receipt, activation, or visibility; CR-03 through CR-06 are blockers. |
| 2 | Read-only probe/doctor accurately distinguish support, missing state, incompatibility, version/source mismatch, visibility, and consistency without repair | PARTIAL | Probe/doctor and hostile-path tests pass, but clean-host state never reached a valid installed state and unsafe shared authority roots limit the evidence boundary. |
| 3 | Default/direct Builder entry paths share the same Discover → Plan → Produce artifacts | VERIFIED | `src/builder-entry.js` is wired through `src/cli.js`; adapter/entry contract tests pass in the 658-test gate. |
| 4 | Pause, compaction, restart, and duplicate replay recover correctly, with behavior evals observing trigger/non-trigger/recovery/deduplication | FAILED | Synthetic behavior tests pass; no real scenario ran, and CR-07/CR-08 break the exact recovery invariant. |
| 5 | Lifecycle operations mutate only exact receipt/marker/digest-owned assets, preserve foreign/modified state, and never infer support from the neutral contract | FAILED | Neutral-boundary tests pass, but CR-03 through CR-07 invalidate exact ownership and cleanup under failure/race. |

**Roadmap score:** 1/5 verified.
**Plan-truth regression score:** 41/73 verified. Partial or failed truths are not counted.

### Plan Must-Have Regression Ledger

| Plan | Verified | Result | Main limiting evidence |
| --- | ---: | --- | --- |
| 02-01 | 3/3 | VERIFIED | Neutral adapter, read-only probe, and shared entry remain wired and tested. |
| 02-02 | 1/3 | FAILED | Hook proposal-only boundary passes; checkpoint/replay guarantees are undermined by CR-07/CR-08. |
| 02-03 | 2/3 | FAILED | Package and doctor exist; setup/receipt atomicity fails under CR-03/CR-04 and the real attempt. |
| 02-04 | 1/3 | FAILED | Evidence-level separation holds; lifecycle ownership and real recovery/UAT do not. |
| 02-05 | 3/4 | FAILED | Closure, launcher, and bounded claim pass; runtime projection safety fails under CR-03/CR-04. |
| 02-06 | 2/4 | FAILED | Packed host module and doctor wiring pass; activation and owner/ledger safety fail under CR-03/CR-06. |
| 02-07 | 1/4 | FAILED | Inventory is canonical; shared-state preservation and exact lifecycle authority fail under CR-06. |
| 02-08 | 2/5 | FAILED | Proposal-only payload and packed bridge pass; journal/replay and trusted challenge evidence do not. |
| 02-09 | 3/5 | FAILED | Schema, packaging, and evidence separation exist; provenance/admission is forgeable under CR-01/CR-02. |
| 02-10 | 3/5 | FAILED | Documentation remains bounded; formal UAT and exact admission were not completed. |
| 02-11 | 2/4 | FAILED | Private event admissions and neutral claims pass; journal cleanup/restart safety fail under CR-07/CR-08. |
| 02-12 | 4/4 | VERIFIED | Latest review no longer reports the earlier lifecycle retained-handle defect; focused lifecycle tests pass. |
| 02-13 | 1/5 | FAILED | Marketplace identity contract exists; fresh-host activation, compensation, and rebind safety fail under CR-03/CR-06. |
| 02-14 | 4/5 | FAILED | Closure and I/O coverage pass; the packed immutable loader inherits CR-07/CR-08. |
| 02-15 | 1/5 | FAILED | Terminal derivation exists; raw append authority and missing real activation/scenarios invalidate the closed UAT chain. |
| 02-16 | 5/5 | VERIFIED | Synthetic continuation, candidate-before-decision ordering, orphan recovery, and verifier preflight are tested. These are mechanism evidence only. |
| 02-17 | 3/6 | FAILED | Verifier-inclusive release and bounded docs exist; setup/activation, continuation, preview, and human decision never occurred. |

## Required Artifacts

| Artifact | Expected | Status | Details |
| --- | --- | --- | --- |
| `src/builder-entry.js` / `src/cli.js` | Shared Builder entry and CLI wiring | VERIFIED | Imported, invoked, and covered by entry/CLI tests. |
| `src/builder-package.js` / `plugin/` | Self-contained packed release surface | VERIFIED | Closure and artifact-surface gates pass; Plan 02-17 releases included the verifier. |
| `src/builder-probe.js` / `src/builder-doctor.js` | Read-only capability and diagnostic surfaces | VERIFIED (bounded) | Substantive and wired; tests prove read-only mechanism behavior, not clean-host success. |
| `src/builder-install.js` | Preview-bound install and exact receipt publication | FAILED | CR-03/CR-04; actual setup left inconsistent projection with no receipt. |
| `src/builder-codex-host.js` | Exact host registration/activation ownership | FAILED | CR-05/CR-06. |
| `src/builder-immutable-journal.js` | Append-only, recoverable exact evidence chain | FAILED | CR-07/CR-08. |
| `src/builder-codex-uat.js` / packed verifier | Non-forgeable UAT and human decision chain | FAILED | CR-01/CR-02. |
| `src/builder-lifecycle.js` | Exact upgrade/uninstall preservation | PARTIAL | Local lifecycle paths pass tests, but depend on unsafe install/host/journal authority. |

## Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| `src/cli.js` | `src/builder-entry.js` | Builder command dispatch | WIRED | Shared entry contract is exercised by tests. |
| `src/builder-package.js` | `plugin/` and runtime modules | Manifest/closure inventory | WIRED | Complete-or-reject closure tests pass. |
| `src/builder-install.js` | `src/builder-codex-host.js` | Setup apply and host activation | UNSAFE | Connected, but failure rollback strands already-published project files. |
| `src/builder-hook-bridge.js` | immutable journal/checkpoint | Installed event observation | PARTIAL | Connected and tested synthetically; exact journal cleanup/commit behavior is unsafe. |
| `scripts/verify-codex-uat-candidate.js` | `src/builder-codex-uat.js` | Packed verifier preview/decision | UNSAFE | Intended route is wired, but public module APIs permit bypass. |

## Data-Flow Trace (Level 4)

| Artifact | Data | Source | Real data | Status |
| --- | --- | --- | --- | --- |
| Install receipt | planned file/host digests | package manifest + setup preview/apply | Actual apply failed before receipt | FAILED |
| UAT journal | transition entries and chain heads | installed workflow / UAT APIs | Actual two-entry failure chain is real, but APIs can synthesize later histories | FAILED |
| Candidate and decision | exact candidate bytes + verifier digest | journal projection + packed verifier | No actual candidate, preview, or decision exists | FAILED |
| Doctor report | project/host/receipt observation | read-only filesystem inspection | Real failure diagnosis reported inconsistent projection and missing receipt | VERIFIED (diagnostic only) |

## Behavioral Spot-Checks

| Behavior | Command/evidence | Result | Status |
| --- | --- | --- | --- |
| Repository mechanism regression gate | `npm run check` | 658/658 tests pass across 70 suites; 0 failures/skips/todos | PASS (bounded mechanism evidence) |
| Clean-host setup/activation | Sole explicitly authorized Plan 02-17 attempt | `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED` before `setup-applied` | FAIL |
| UAT scenarios and human decision | Preserved two-entry journal and read-only diagnosis | No activation, Codex process, trust/auth, SessionStart, scenario, candidate, preview, decision, or live success | FAIL |

No new actual UAT was run during verification. The failed attempt is terminal and must not be resumed or replaced without repair and explicit approval.

## Probe Execution

No phase-declared `scripts/*/tests/probe-*.sh` exists. The Builder capability probe is a JavaScript module and its read-only behavior is covered by the repository gate. No external host probe was run during this verification.

## Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| CORE-05 | SATISFIED | Neutral adapter and staged artifact contract are substantive, wired, and tested. |
| BLDR-01 | BLOCKED | Clean packed install/activation failed in the only real attempt. |
| BLDR-02 | SATISFIED | Read-only capability probe and package binding tests pass. |
| BLDR-03 | SATISFIED | Default/direct entry paths share the Builder artifact workflow. |
| BLDR-04 | BLOCKED | CR-07/CR-08 invalidate exact durable recovery across cleanup/commit failures. |
| BLDR-05 | PARTIAL | Doctor is substantive/read-only, but the invalid host authority and incomplete actual state prevent full support-state proof. |
| BLDR-06 | BLOCKED | CR-03 through CR-07 invalidate exact lifecycle ownership under failure/race. |
| BLDR-07 | BLOCKED | No real recovery scenario/candidate/decision completed; CR-01/CR-02 make synthetic admission forgeable. |

**Requirements score:** 3/8 satisfied. No additional Phase 2 requirement IDs are orphaned from the plans.

## Latest Code Review Findings

| ID | Severity | File | Verified impact |
| --- | --- | --- | --- |
| CR-01 | BLOCKER | `src/builder-codex-uat.js` | Exported raw append authority can fabricate the complete pre-candidate UAT chain. |
| CR-02 | BLOCKER | `src/builder-codex-uat.js` | Public inspect/decide APIs can append a human admission without running the packed verifier. |
| CR-03 | BLOCKER | `src/builder-install.js` | Host/receipt failure can strand canonical managed files without an ownership receipt. |
| CR-04 | BLOCKER | `src/builder-install.js` | Publication links a replaceable staging pathname after the validated handle is closed. |
| CR-05 | BLOCKER | `src/builder-codex-host.js` | Shared authority accepts foreign-owned or group/world-writable state directories. |
| CR-06 | BLOCKER | `src/builder-codex-host.js` | Owner/ledger CAS, restore, and retract paths can adopt/delete replacements. |
| CR-07 | BLOCKER | `src/builder-immutable-journal.js` | Cleanup can unlink a foreign final-window replacement. |
| CR-08 | BLOCKER | `src/builder-immutable-journal.js` | Append can report failure after durable commit and leave the journal unreadable. |
| WR-01 | WARNING | `src/builder-codex-uat.js` | Content-addressed leaves are written directly at final digest paths; partial writes/races can poison retry. |

Direct source inspection confirmed all eight blockers. The passing test named around verifier-inclusive admission does not falsify CR-01/CR-02 because it exercises the intended script route, while direct imports retain the bypass authority.

No unreferenced `TBD`, `FIXME`, or `XXX` debt marker was found in the Phase 2 implementation surface. `README.md` still describes an older 8-critical/8-warning review count; the current `02-REVIEW.md` is authoritative at 8 critical and 1 warning.

## Actual UAT Boundary

- Exactly one actual attempt was created.
- Setup preview bound apply digest `sha256:48388698a454f21e5e77aa2058fb47c7386c80f00fba9bf6764ef279374642c7`.
- The single apply failed closed with `AGENTMO_BUILDER_INSTALL_HOST_ROLLBACK_FAILED`.
- The immutable two-entry chain ends at the unique failure head `sha256:5a82e22d54bb8a52f1515d54e03d0e0668efdc083637b426d5280b38ebeb8d5f`.
- Read-only diagnosis found projection inconsistent, receipt missing, project marker/agent `unowned-present`, and marketplace/plugin missing.
- There is no setup-applied, activation, Codex process, trust/auth observation, SessionStart, scenario result, candidate, verifier preview, human decision, or live success.
- `declared-ready`, mechanism tests, and live-smoke evidence do not certify domain quality, production readiness, or wider Codex/OpenClaw compatibility.

## Human Verification Required

None is currently actionable. A new real clean-host UAT would mutate external host state and is not a substitute for closing the code blockers. It must remain deferred until targeted repair plans pass review and the developer explicitly authorizes a new isolated attempt.

## Deferred Items

No gap is clearly assigned to a later milestone phase. Phases 3–6 cover discovery, runtime package production, OpenClaw integration, and domain-agent releases; none explicitly owns these Phase 2 transaction, evidence-authority, or journal defects.

## Gaps Summary

The phase has 17/17 plans executed, but completion did not produce the promised clean-host outcome. Three root concerns block the goal: unsafe install/host ownership transactions (CR-03–CR-06), forgeable UAT/human-decision authority (CR-01–CR-02), and unsafe immutable-journal cleanup/commit behavior (CR-07–CR-08). WR-01 is an additional durability warning. The sole real UAT correctly failed closed and must be preserved as failure evidence, not reinterpreted as successful validation.

**Next command:** `/gsd:plan-phase 02 --gaps`

---

_Verified: 2026-07-20T16:04:54Z_
_Verifier: the agent (gsd-verifier)_
