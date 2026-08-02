---
phase: 04-package
plan: "09"
subsystem: openclaw-install-transaction
tags: [openclaw, receipt-last, exact-admission, conservative-recovery, credential-handoff]
requires:
  - phase: 04-package
    plan: "08"
    provides: Fresh-process lifecycle plans and independent approval/genesis/predecessor authorities
provides:
  - One exact-admission lifecycle apply seam with private pre-effect journal and receipt-last publication
  - Create-only complete/incomplete install receipt writer with immutable predecessor sequence handling
  - Four-predicate conservative recovery and value-blind official OpenClaw credential handoff
  - Archive-only openclaw-install-apply CLI subjects, parser, help, and action-specific authority routing
affects: [04-10-install-evidence, phase-5-runtime, openclaw-lifecycle]
tech-stack:
  added: []
  patterns:
    - Fresh exact file plus caller SHA-256 admission before every effect
    - No-follow retained D-42 closure validation before the private journal
    - Post-observation followed by create-only receipt-last publication
    - Value-blind SecretPresence carrier across an injected official OpenClaw seam
key-files:
  created:
    - src/openclaw-install-transaction.js
    - src/openclaw-credential-handoff.js
    - test/openclaw-install-transaction.test.js
    - .planning/phases/04-package/04-09-SUMMARY.md
  modified:
    - src/openclaw-install-receipt.js
    - src/artifact-subjects.js
    - src/cli.js
    - test/phase4-contracts.test.js
    - release/2026.07.30.md
    - release/README.md
key-decisions:
  - "Apply accepts only explicit durable file/external-SHA-256 pairs; parsed authorities, package roots, manifest-only inputs, force, purge, blanket overwrite, and MCP remain unsupported."
  - "Any ownership, retained-identity, base-digest, conflict, or post-observation ambiguity preserves the target and forces an incomplete receipt instead of guessing authority."
  - "Credential values remain outside AgentMo artifacts and argv evidence; only presence and bounded result metadata may persist."
patterns-established:
  - "Receipt-last transaction: exact admissions -> immediate re-probe/ownership observation -> synced private journal -> effects -> post-observation -> exclusive receipt."
  - "Immutable lifecycle linkage: successor sequence derives from the exact admitted current receipt, never a caller-supplied counter."
requirements-completed: [OCLW-03, OCLW-04, OCLW-05, EVID-05]
coverage:
  - id: D1
    description: "Fresh apply exact-admits every install authority and the complete D-42 closure before any disposable target effect."
    requirement: OCLW-03
    verification:
      - kind: integration
        ref: "test/openclaw-install-transaction.test.js#re-admits durable files, applies only inside a disposable root, post-observes, then publishes receipt last"
        status: pass
    human_judgment: false
  - id: D2
    description: "Automatic recovery requires created-by-attempt, exact owner marker, retained identity, and unchanged desired digest; each independent mismatch preserves."
    requirement: OCLW-05
    verification:
      - kind: security
        ref: "test/openclaw-install-transaction.test.js#requires all four automatic-recovery predicates before removing an attempt asset"
        status: pass
      - kind: security
        ref: "test/openclaw-install-transaction.test.js#re-observes owner marker, retained identity and desired digest instead of trusting path facts"
        status: pass
    human_judgment: false
  - id: D3
    description: "The CLI exposes exact action-specific subjects and file/digest mates without package-root, force, purge, credential-value, or MCP alternatives."
    requirement: OCLW-04
    verification:
      - kind: contract
        ref: "test/phase4-contracts.test.js#Phase 4 Wave 9 exposes one receipt-last lifecycle seam and no MCP route"
        status: pass
      - kind: integration
        ref: "test/openclaw-install-transaction.test.js#publishes an explicit archive-only CLI contract and rejects a missing digest mate pre-effect"
        status: pass
    human_judgment: false
  - id: D4
    description: "Credential setup crosses only a fake approved official OpenClaw seam and persists no value or raw output."
    requirement: EVID-05
    verification:
      - kind: security
        ref: "test/openclaw-install-transaction.test.js#keeps credential setup value-blind and permits only an approved official seam"
        status: pass
    human_judgment: false
duration: 23min
completed: 2026-07-30
status: complete
---

# Phase 4 Plan 9: Receipt-Last Lifecycle Transaction Summary

**Fresh exact admission, retained D-42 validation, a synced private journal, conservative ownership recovery, and create-only receipt-last publication now form one bounded OpenClaw lifecycle mechanism**

## Performance

- **Duration:** 23 min
- **Started:** 2026-07-30T02:41:27Z
- **Completed:** 2026-07-30T03:03:42Z
- **Tasks:** 3/3
- **Files created/modified:** 10

## Accomplishments

- Added the sole `applyOpenClawInstallPlan` mutation seam. It rejects caller-parsed authorities and exact-admits target/carrier, probe, plan, ordinary approval, every sensitive decision, conditional conflict approval, and action-specific genesis/receipt inputs from explicit files plus external SHA-256 values.
- Retained the deterministic archive no-follow and revalidated its outer digest, canonical envelope, manifest digest, inventory digest, complete member set, relative path, type, mode, byte length, member digest, and retained identity before writing the private journal.
- Added immediate probe/ownership/conflict observation, a synced private journal, per-path post-observation, create-only complete/incomplete receipt publication, immutable successor sequencing, and conservative recovery that removes only an attempt-created pristine owned asset.
- Added a value-blind official credential handoff whose persisted result contains presence and bounded exit metadata only, with `shell:false`, no secret-value flags, no raw output, and no MCP route.
- Wired `openclaw-install-apply` help, parser, command subjects, action-specific genesis/current/selected-predecessor authority pairs, required absent output, and bounded human/JSON handling.

## Task Results

### Task 1: Write the failing receipt-last transaction journey

- RED ran `node --test test/openclaw-install-transaction.test.js test/phase4-contracts.test.js`.
- The new transaction suite and Wave 9 contract extension failed as expected because `src/openclaw-install-transaction.js` did not exist.
- The focused matrix covers create-only receipt publication, each independent automatic-recovery predicate, fresh external re-observation, value-blind credential handoff, parsed-authority/package-root rejection, one fresh child-process install apply, archive byte/member/symlink drift, and CLI mate/help failures.

### Task 2: Implement lifecycle mutation, recovery, credential handoff, and receipt

- Admission order and D-42 closure complete before the journal or target effect; same-process objects and embedded digests cannot substitute for durable authority.
- Target mutation is preservation-first: only an exact absent-file `write` with matching retained parent authority is created. Non-create, conflicting, identity-drifted, externally owned, or otherwise ambiguous operations are left untouched and cannot produce a false complete receipt.
- Recovery does not trust caller path booleans. Public recovery re-reads the owner marker, file identity, and current bytes; internal recovery uses attempt-authentic descriptors and the same four facts.
- Complete and incomplete receipts publish exclusively from validated persistable bytes and re-read final bytes externally before reporting their digest.

### Task 3: Publish receipt-last lifecycle CLI routes

- `subjectsForCommand("openclaw-install-apply", ...)` resolves the fixed common subjects, one subject per sensitive decision, optional conflict authority, and exact install/upgrade/rollback/uninstall predecessor family.
- The CLI requires every file/SHA-256 mate, rejects duplicate or unknown options, requires an absent `--out`, and exposes no package-root, manifest-only, force, purge, credential-value, raw-output, or MCP alternative.
- A separate Node process consumed only durable fixture files and external digests, mutated only a disposable `mkdtemp()` target, post-observed the result, and published the complete receipt last.

## Verification

| Gate | Result |
| --- | --- |
| RED focused transaction + Phase 4 gate | expected fail: 2 failing test files for missing transaction module |
| Focused transaction + incremental Phase 4 gate | 16 pass, 0 fail |
| Required Wave 9 gate: artifact admission + plan + approval + transaction + Phase 4 contracts | 50 pass, 0 fail |
| Bounded adjacent artifact-subject + maintained-command-doc gate | 15 pass, 0 fail |
| `node --check` on five production and two focused test files | pass |
| Scoped `git diff --check` | pass |
| Stub/trailing-whitespace scan | pass: no blocking placeholder or whitespace finding |

The full `npm run check` was intentionally not run because the parent execution contract explicitly requested the exact five-file Wave 9 gate plus bounded adjacent checks, not the shared-worktree aggregate suite.

## Certification Boundary

Every effect-bearing test was temporary-fixture-only:

- target roots came from disposable `mkdtemp()` directories;
- the child-process success path consumed copied fixture artifacts and a repository-owned deterministic package archive;
- the credential handoff crossed only an injected fake official seam;
- no real OpenClaw HOME/state/config/workspace, credential, plugin, schedule, MCP surface, or operator target was read or mutated.

This summary proves bounded Phase 4 transaction mechanism behavior only. It does not prove a live OpenClaw install, upgrade, rollback, uninstall, credential login, activation, agent execution, schedule trigger, restart recovery, domain quality, Birth, Delivery, production readiness, deployment, or wider OpenClaw compatibility. Real lifecycle proof remains absent and Phase 5-owned.

The focused effect matrix executes the exact install/create path in a fresh child process. Upgrade, rollback, and uninstall use the same public seam and have exact action-specific subject/parser/predecessor contracts, but their real target mutation journeys were not run here; that distinction is intentionally preserved rather than promoted into live evidence.

## Decisions Made

- Kept the transaction API closed over exact durable paths and caller-reported external SHA-256 values instead of accepting trusted builder returns, parsed objects, directories, or embedded digests.
- Treated any ownership ambiguity as preservation and incomplete evidence; no recursive deletion, path-only ownership, force, purge, or blanket overwrite behavior was introduced.
- Derived non-install successor sequence from the exact admitted current receipt and kept the public predecessor schema unchanged.
- Rejected nonzero or timed-out official action results before complete receipt publication and discarded raw stdout/stderr from persisted metadata.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Made credential presence persistable without carrying a token-like string**

- **Found during:** Task 2 GREEN
- **Issue:** A direct environment-name array was correctly rejected by the persistability boundary because it resembled secret-bearing material.
- **Fix:** Replaced it with the existing value-blind `SecretPresence` carrier and retained only bounded presence/result facts.
- **Files modified:** `src/openclaw-credential-handoff.js`

**2. [Rule 1 - Bug] Corrected immediate re-probe comparison**

- **Found during:** Task 2 fresh-process verification
- **Issue:** The retained JSON admission wrapper, rather than its validated `.value`, was passed into probe-basis comparison and caused an otherwise exact apply to fail stale.
- **Fix:** Compare the exact validated probe value to the plan fingerprint.
- **Files modified:** `src/openclaw-install-transaction.js`

**3. [Rule 1 - Bug] Kept preserved receipts schema-valid and successor lineage immutable**

- **Found during:** Final closeout review
- **Issue:** A preserved operation could request an incomplete receipt without the existing contract-required failed operation, and non-install successor sequence defaulted to one instead of inheriting the admitted current receipt.
- **Fix:** Convert the preserved ambiguity into an explicit failed observation while retaining its preservation record, and derive the next sequence from the exact admitted predecessor receipt.
- **Files modified:** `src/openclaw-install-transaction.js`

**4. [Rule 2 - Missing Critical Functionality] Re-observed automatic-recovery facts instead of trusting caller booleans**

- **Found during:** Task 2 security review
- **Issue:** Four caller booleans alone would make recovery path-authority based and allow modified/replaced assets to be removed.
- **Fix:** Require the actual owner-marker digest, current retained device/inode, and current desired-content digest for public recovery; internal recovery accepts only attempt-authentic descriptors.
- **Files modified:** `src/openclaw-install-transaction.js`, `test/openclaw-install-transaction.test.js`

## AGENTS.md-Driven Adjustments

- Extended `release/2026.07.30.md` and indexed it in `release/README.md` because this plan changes lifecycle, receipt, credential-boundary, and certification semantics.
- Used only disposable project roots and fake seams; did not read `.env`, credentials, sessions, databases, raw provider payloads, raw transcripts, or credential-bearing OpenClaw state.
- Did not stage, commit, push, stash, reset, checkout, switch, or modify `.planning/STATE.md`, `.planning/ROADMAP.md`, or `.planning/REQUIREMENTS.md`.

## Known Stubs

None. The conservative non-create preservation path and injected official credential runner are deliberate least-authority boundaries, not mock data or unfinished UI/data wiring. The real lifecycle journeys explicitly remain Phase 5 evidence work.

## Threat Review

- T-04-32/T-04-33: target paths are portable and root-contained; retained parent/file identity, current digest, probe fingerprint, conflict set, and the complete D-42 closure dominate effects.
- T-04-34/T-04-35: official actions are decision-bound, `shell:false`, bounded, value-blind, and raw-output-free; credential values and MCP never enter the public surface.
- T-04-36: recovery requires all four independent facts and re-observes actual files before unlinking; every ambiguity preserves.
- T-04-37/T-04-40: receipts publish create-only after post-observation and keep runtime/domain/Birth/Delivery/production/wider-compatibility claims false.
- T-04-38/T-04-39: every authority is accepted only as exact subject/file/external-digest bytes; missing mates, drift, package-root shortcuts, stale probes, and archive mutation fail before effects.
- No unplanned network endpoint, database/schema boundary, plugin load, schedule path, MCP connection, or real authentication surface was introduced.

## Git Status

No commits were created. This execution obeyed the parent contract prohibiting staging, committing, pushing, stashing, resetting, checkout, or switch in the shared dirty worktree.

## Next Phase Readiness

- Plan 04-10 can exact-admit the bounded receipt and build evidence without treating it as runtime or domain proof.
- Phase 5 remains responsible for isolated real install/upgrade/rollback/uninstall, activation, schedule, restart, memory/RAG, bounded eval, and Birth/Delivery proof.
- No later consumer may treat a complete receipt as self-certification, bypass external digest admission, infer ownership from a path, or broaden the official credential seam into secret persistence.

## Self-Check: PASSED

- All seven planned production/test files, the release record/index entry, and this summary exist.
- The focused suite passed 16/16; the exact required Wave 9 gate passed 50/50; the bounded adjacent gate passed 15/15.
- Syntax checks and scoped `git diff --check` passed.
- Stub and threat-surface scans found no blocking placeholder or unplanned trust boundary.
- All effect tests remained inside disposable fixtures or fake seams, and Phase 5/live proof remains explicitly absent.
- Commit verification is not applicable because Git writes were explicitly prohibited.
