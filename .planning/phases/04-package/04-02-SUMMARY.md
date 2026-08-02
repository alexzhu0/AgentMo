---
phase: 04-package
plan: "02"
subsystem: target-carrier-admission
tags: [openclaw, native-plugin-recipe, exact-digest, retained-read, fail-closed]
requires:
  - phase: 03-build-contract
    provides: Exact blueprint/build-contract/plan-approval authority and OpenClaw target descriptor
  - phase: 04-package
    plan: "01"
    provides: Fail-closed carrier selection and canonical recipe authority boundary
provides:
  - Canonical package-local native-plugin recipe bound into the Phase 3 build contract
  - Exact OpenClaw target/carrier admission with no implementation path and no MCP authority
  - Human-selected durable downstream admission path and raw-byte SHA-256
affects: [04-03-package-produce, 04-04-package-inspect, produce-authority]
tech-stack:
  added: []
  patterns:
    - Raw-byte admission followed by semantic source-chain revalidation
    - Read-only retained target re-observation before downstream authority selection
    - Recipe authority precedes and is separate from recipe-byte materialization
key-files:
  created:
    - src/openclaw-target-admission.js
    - test/openclaw-build-contract.test.js
    - test/openclaw-target-admission.test.js
    - .planning/phases/04-package/04-02-native-plugin-recipe.json
    - .planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json
    - .planning/phases/04-package/04-02-SUMMARY.md
  modified:
    - src/build-contract.js
    - src/artifact-contract.js
    - src/artifact-registry.js
    - src/artifact-subjects.js
    - src/cli.js
    - test/phase4-contracts.test.js
key-decisions:
  - "The exact selected downstream authority is .planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json at sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6."
  - "No second approval subject was invented: the product contract models the create-only target/carrier admission itself as the durable exact authority."
  - "Plan 04-03 remains the first and only plan authorized to materialize native-plugin bytes; this approval grants no package, install, activation, runtime, domain, or production authority."
patterns-established:
  - "Exact target gate: reobserve three retained first-party members and require canonical descriptor bytes plus authority digest to remain unchanged."
  - "Carrier closure: exactly four approved hook mappings, native-plugin owner, implementationPathAccepted=false, and mcp=false."
requirements-completed: [PACK-02, PACK-03, PACK-04, OCLW-01, EVID-05]
coverage:
  - id: D1
    description: "The recipe-bearing build contract and exact plan approval close authority over future native-plugin bytes without accepting or producing an implementation path."
    requirement: PACK-03
    verification:
      - kind: integration
        ref: "test/openclaw-build-contract.test.js#OpenClaw build-contract binding"
        status: pass
      - kind: integration
        ref: "fresh-process exact admission and recipe digest recomputation"
        status: pass
    human_judgment: false
  - id: D2
    description: "The current OpenClaw executable is bound to one create-only target/carrier admission with four hook mappings, no MCP, and all non-certification flags false."
    requirement: OCLW-01
    verification:
      - kind: integration
        ref: "test/openclaw-target-admission.test.js#OpenClaw exact target/carrier admission"
        status: pass
      - kind: integration
        ref: "read-only target re-observation and canonical descriptor byte comparison"
        status: pass
    human_judgment: false
  - id: D3
    description: "The operator selected the exact admission path and digest as the only durable downstream Produce authority."
    requirement: EVID-05
    verification:
      - kind: manual_procedural
        ref: "2026-07-29 exact user approval reproduced in the Authority Graph section"
        status: pass
      - kind: integration
        ref: "raw SHA-256 recomputation plus fresh-process source-chain re-admission"
        status: pass
    human_judgment: false
duration: 10min
completed: 2026-07-29
status: complete
---

# Phase 4 Plan 2: Recipe-Bound OpenClaw Target/Carrier Admission Summary

**Exact recipe-bearing Phase 3 authority and read-only-reobserved OpenClaw target are closed into one human-selected, create-only carrier admission without materializing plugin bytes**

## Performance

- **Duration:** approximately 10 min for the final Task 3 continuation
- **Completed:** 2026-07-29T11:08:23Z
- **Tasks:** 3/3
- **Files modified by final continuation:** 1 summary file

## Accomplishments

- Recomputed the raw SHA-256 for every path in the operator's exact approval and required byte-for-byte equality before accepting the checkpoint.
- Fresh-process re-admitted the exact plan approval, target descriptor, and target/carrier admission with their complete companion authority chain.
- Reobserved the installed OpenClaw target read-only and proved that the canonical descriptor bytes, descriptor authority digest, target-root closure, executable digest, package metadata digest, build-info digest, and retained identities had not drifted.
- Selected one durable downstream authority: `.planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json` at `sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6`.
- Preserved the boundary that Plan 04-02 approves recipe and target/carrier admission only. It creates no Package, plugin implementation bytes, installation, activation, runtime execution, domain evidence, or production evidence.

## Exact Authority Graph

```text
.planning/phases/04-package/04-02-blueprint.json
  sha256:e0eaf74181216f2fceb0d55708837e9af2ae90c9f04c1f05bdb3764c6ac4f2c9
       |
       +--> .planning/phases/04-package/04-02-build-contract.json
       |      sha256:0a5472dd44e7c7c03b92ced9ccbf15ddec55fc668a5c8a4d6b203629ac14d05b
       |      nativePluginRecipe.recipeDigest:
       |      sha256:5bd43924237a304222f60a9788a8f0130819ba0208f567ebfc798b0735205402
       |
       +--> .planning/phases/04-package/04-02-plan-approval.json
       |      sha256:42f31fbe1654d9d9b2d5a5331a516e1ab0e79d319a2faf4bd882013695cf53cd
       |
.planning/phases/04-package/04-02-openclaw-target-descriptor.json
  sha256:0abad669ae3cac7b6219737a728df21799eeec6ac7946e8fd38285f9e4322bee
  authorityDigest:
  sha256:db260e3f2a4af92f3e0fc3518a0f1552b0c8b6d5ebe19d127b27f3a1ae01cf06
       |
       +--> .planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json
              sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6
              selected durable downstream authority
```

The admission repeats the exact build-contract, plan-approval, target-descriptor, blueprint, executable, and canonical recipe digests. It binds exactly:

| Abstract hook | OpenClaw event | Permission | Timeout | Failure |
|---|---|---|---:|---|
| `after-attempt` | `agent_end` | `observe-attempt-completion` | 5000 ms | fail-closed |
| `after-tool` | `after_tool_call` | `observe-tool-result-metadata` | 5000 ms | fail-closed |
| `before-attempt` | `before_agent_run` | `enforce-attempt-boundary` | 5000 ms | fail-closed |
| `before-checkpoint` | `before_compaction` | `enforce-checkpoint-boundary` | 5000 ms | fail-closed |

`carrier.implementationPathAccepted` is `false`; `carrier.mcp` is `false`.

## Task Commits

No commits were created because `AGENTS.md` requires explicit commit authorization and the execution assignment explicitly prohibited staging, committing, pushing, stashing, resetting, checking out, switching, or starting a new branch.

1. **Task 1: Define the failing canonical recipe and target/carrier admission** — `not-created — commit authorization withheld`
2. **Task 2: Implement recipe-bound durable target/carrier admission** — `not-created — commit authorization withheld`
3. **Task 3: Verify and select the exact admission artifact** — verification-only checkpoint; `not-created`
4. **Plan metadata** — `not-created — commit authorization withheld`

## Files Created/Modified

- `src/build-contract.js` — validates and embeds canonical native-plugin recipe content and recomputes member plus recipe digests.
- `src/openclaw-target-admission.js` — exact target/carrier builder, validator, fresh source-chain checker, and create-only writer.
- `src/artifact-contract.js` — public descriptor for the target/carrier admission subject.
- `src/artifact-registry.js` — closed registry and companion-aware re-admission validation.
- `src/artifact-subjects.js` — exact durable CLI subject closure without plugin-byte or MCP inputs.
- `src/cli.js` — public `openclaw-target-admit` route.
- `test/openclaw-build-contract.test.js` — recipe determinism, mutation, and Phase 3 reapproval matrix.
- `test/openclaw-target-admission.test.js` — target drift, stale authority, create-only, no-path, and no-MCP matrix.
- `test/phase4-contracts.test.js` — Wave 2 durable downstream authority and certification-boundary gate.
- `.planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json` — selected exact downstream authority.

## Decisions Made

- The user's exact approval is admitted only for the listed build contract, plan approval, target descriptor, canonical recipe digest, and target/carrier admission digest. No broader wording is inferred.
- The existing create-only target/carrier admission is already the modeled human-selected durable subject. Creating a separate "selection approval" artifact would invent a new approval subject and weaken the closed contract.
- The target was reobserved from current first-party files without running an OpenClaw agent, altering OpenClaw state, or reading credentials/session state.
- Plan 04-03 may independently re-admit the selected bytes and materialize only the recipe they bind; it may not infer installation, activation, or runtime authority.

## Deviations from Plan

### User-Approved Architectural Deviation

**1. Rebuilt the Phase 3 authority chain from newly exact-approved current inputs**

- **Found during:** Tasks 1–2 authority recovery
- **Issue:** The previously approved Phase 3 source-pair raw bytes were unavailable, so reconstructing them from summaries or historical digests would have created false authority.
- **Approved adjustment:** Regenerate the chain from currently available exact source artifacts only after a separate exact human decision, then bind the recipe-bearing build contract and target descriptor into a new exact plan approval.
- **Boundary:** The recovery grants only the new exact discovery/plan authority it names. It does not restore unavailable historical bytes or certify source, package, runtime, domain, or production quality.
- **Durable evidence:** `.planning/phases/04-package/04-02-source-authority-recovery.json` plus the exact regenerated authority files listed above.
- **Commit:** `not-created — commit authorization withheld`

### Policy-Required Adjustment

**2. No task or metadata commits**

- **Found during:** executor startup
- **Adjustment:** Preserved the shared dirty worktree and made no Git mutation beyond writing this requested summary.
- **Verification:** Explicit-path status inspection and `git diff --check` completed without staging.
- **Commit:** `not-created — commit authorization withheld`

**Total deviations:** 1 user-approved authority-recovery deviation and 1 repository-policy adjustment. Neither broadens the target/carrier approval.

## Verification

- **Exact user-authority SHA-256 recomputation:** exit 0; build contract, plan approval, target descriptor, and target/carrier admission all matched the supplied digests.
- **Fresh-process exact source-chain admission:** exit 0 for `plan-approval`, `openclaw-target-descriptor`, and `openclaw-target-carrier-admission`.
- **Read-only target re-observation:** exit 0; canonical descriptor digest remained `sha256:0abad669ae3cac7b6219737a728df21799eeec6ac7946e8fd38285f9e4322bee` and authority digest remained `sha256:db260e3f2a4af92f3e0fc3518a0f1552b0c8b6d5ebe19d127b27f3a1ae01cf06`.
- **Bounded Wave 2 plus target/artifact/CLI/Phase 3/Phase 4 adjacent gate:** 98/98 passed, 0 failed, 0 cancelled, 0 skipped.
- **Relevant production-module `node --check`:** exit 0.
- **`git diff --check`:** exit 0.
- The long full `npm run check` suite was intentionally not run; the assignment required bounded adjacent gates and explicitly excluded the long aggregate.

## Known Stubs

None. Stub-pattern hits were validator accumulators, explicit optional/null contract states, or hostile test mutations. No empty/mock data source or placeholder blocks the plan goal.

## Threat Review

- **T-04-05:** the current executable identity, package metadata, build information, root closure, and retained file identities were reobserved before admission and matched the approved target descriptor.
- **T-04-06:** the admission accepts only the canonical recipe digest and four exact native-hook mappings; it accepts no implementation path, plugin bytes, or MCP lane.
- **T-04-07:** the exact human-selected admission bytes and external digest are recorded as the sole downstream authority; a verbal success flag or broad approval cannot substitute.
- No new network endpoint, authentication route, secret surface, target mutation, package writer, install action, activation action, or runtime execution was introduced during Task 3.

## Certification Boundary

This summary proves only exact recipe authority, current target identity re-observation, and exact target/carrier admission selection.

| Claim | Status |
|---|---|
| Exact target/carrier admission selected | true |
| Native-plugin bytes materialized | false |
| Agent Package built | false |
| Installed | false |
| Activated | false |
| Runtime executed | false |
| Domain quality certified | false |
| Production approved | false |

## User Setup Required

None.

## Next Phase Readiness

- Plan 04-03 may consume only `.planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json` at `sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6`, after independently re-admitting its exact source chain.
- This completion does not itself start Plan 04-03 and does not materialize Package or native-plugin bytes.

## Self-Check: PASSED

- The summary and all key source, test, and authority files exist.
- All four exact user-approved raw-byte digests were recomputed again after summary creation and remained unchanged.
- The summary contains no absolute HOME/temp path, `.env` reference, credential value, raw provider payload, transcript, or runtime session state.
- The bounded 98-test gate, syntax checks, and final `git diff --check` all exited 0.
- No STATE.md, ROADMAP.md, Package, plugin implementation file, install/activation artifact, runtime evidence, domain evidence, Git stage, or commit was created by this continuation.

---
*Phase: 04-package*
*Completed: 2026-07-29*
