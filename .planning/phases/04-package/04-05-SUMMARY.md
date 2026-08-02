---
phase: 04-package
plan: "05"
subsystem: openclaw-capability-probe
tags: [openclaw, d42-archive, synthetic-home, capability-fingerprint, fail-closed]
requires:
  - phase: 04-package
    plan: "04"
    provides: Exact offline-inspected D-42 package closure and public package-manifest admission
provides:
  - Durable read-only OpenClaw capability fingerprint bound to exact archive and target authorities
  - Disposable synthetic HOME/state/config/workspace subprocess isolation with explicit no-secret environment
  - Public openclaw-probe artifact contract, registry entry, command subjects, and create-only CLI
affects: [04-06-package-preview, package-approval, package-apply]
tech-stack:
  added: []
  patterns:
    - External-first archive and target authority admission before any child process
    - Fixed argv through process.execPath with shell false and no inherited environment
    - Stable normalized facts and digests instead of raw child output or shadow paths
key-files:
  created:
    - src/openclaw-probe.js
    - src/openclaw-probe-contract.js
    - test/openclaw-probe.test.js
    - .planning/phases/04-package/04-05-SUMMARY.md
  modified:
    - src/artifact-contract.js
    - src/artifact-registry.js
    - src/artifact-subjects.js
    - src/cli.js
    - test/phase4-contracts.test.js
    - test/artifact-admission.test.js
    - test/artifact-contract.test.js
    - test/artifact-subjects.test.js
    - test/cli.test.js
    - release/2026.07.29.md
key-decisions:
  - "Only an externally SHA-256-bound D-42 archive plus exact target/carrier and descriptor authorities may reach capability observation."
  - "OpenClaw observations use three fixed read-only argv surfaces in a disposable synthetic HOME with shell:false and no inherited process environment."
  - "The durable fingerprint stores normalized facts and digests only; compatibility observation never certifies install, runtime, domain, Birth, Delivery, or production."
patterns-established:
  - "Probe contract separation: the schema identity and validator live in a dependency-light module so registry admission cannot create an ESM cycle."
  - "Create-only evidence: the public route rejects an existing destination before target observation and uses an exclusive write."
requirements-completed: [OCLW-01, OCLW-05]
coverage:
  - id: D1
    description: "The probe exact-admits the complete D-42 closure and exact target authorities before any target child observation."
    requirement: OCLW-01
    verification:
      - kind: integration
        ref: "test/openclaw-probe.test.js#binds the exact archive and target authority without touching operator state"
        status: pass
      - kind: security
        ref: "test/openclaw-probe.test.js#fails before a child process when archive or exact target bytes drift"
        status: pass
    human_judgment: false
  - id: D2
    description: "Every child process uses a disposable synthetic HOME, fixed argv, shell false, bounded output, and an explicit non-secret environment."
    requirement: OCLW-05
    verification:
      - kind: integration
        ref: "test/openclaw-probe.test.js#binds the exact archive and target authority without touching operator state"
        status: pass
      - kind: contract
        ref: "test/phase4-contracts.test.js#Phase 4 Wave 5 exposes one archive-bound read-only OpenClaw probe artifact"
        status: pass
    human_judgment: false
  - id: D3
    description: "The public create-only artifact route, production validator, registry, and subject map remain durable and non-certifying."
    requirement: OCLW-05
    verification:
      - kind: integration
        ref: "test/openclaw-probe.test.js#exposes a create-only durable JSON CLI route"
        status: pass
      - kind: contract
        ref: "test/artifact-contract.test.js#exports closed subjects whose minimal templates pass production validators"
        status: pass
    human_judgment: false
duration: 1h 27min
completed: 2026-07-29
status: complete
---

# Phase 4 Plan 5: Read-Only OpenClaw Capability Fingerprint Summary

**Exact D-42 and target authority admission now feeds a stable, value-blind OpenClaw capability fingerprint whose fixed subprocess observations are isolated in a disposable synthetic HOME**

## Performance

- **Duration:** 1h 27 min
- **Started:** 2026-07-29T12:24:27Z
- **Completed:** 2026-07-29T13:51:54Z
- **Tasks:** 2/2
- **Files created/modified:** 14

## Accomplishments

- Added `probeOpenClawTarget` with the current-process runtime barrier, exact external archive digest admission, D-42 manifest/inventory/member closure inspection, exact target/carrier and descriptor admission, and bounded retained no-follow target member reads before any child process.
- Added three fixed read-only observations for version, eligible skills, and configuration validation through `process.execPath`, fixed argv, `shell:false`, bounded stdout/stderr, a ten-second timeout, and an explicit environment containing only synthetic HOME/state/config/workspace and locale controls.
- Added normalized archive, target, runtime, CLI, workspace/skill, plugin/MCP, policy/config, permission, and conflict facts to one recomputable fingerprint without retaining raw output, operator paths, synthetic paths, or secret-bearing values.
- Added the public `agentmo.openclaw-probe.v1` schema/template, production validator, artifact registry entry, durable subject mapping, help text, human formatter, and exclusive create-only JSON output route.
- Added drift, isolation, non-certification, registry, contract, command-subject, CLI, and incremental Phase 4 coverage.

## Exact Authority Boundary

| Authority | Exact value |
|---|---|
| Sole downstream D-42 archive | `.planning/phases/04-package/04-03-agent-package.d42` |
| Archive SHA-256 | `sha256:7726d7b635a972403c598bf53eeb9c44a75c57ffd5c4a573470a066a798b955f` |
| Target/carrier admission | `.planning/phases/04-package/04-02-openclaw-target-carrier-admission-candidate.json` |
| Target/carrier admission SHA-256 | `sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6` |
| Target descriptor | `.planning/phases/04-package/04-02-openclaw-target-descriptor.json` |
| Target descriptor SHA-256 | `sha256:0abad669ae3cac7b6219737a728df21799eeec6ac7946e8fd38285f9e4322bee` |

No package directory, standalone manifest, inferred target, or stale approval may substitute for these downstream authorities.

## Task Results

### Task 1: Write the failing read-only probe contract

- RED was observed: `node --test test/openclaw-probe.test.js test/phase4-contracts.test.js` failed because `src/openclaw-probe.js` did not exist.
- The test suite now verifies exact archive and target authority binding, operator-state byte identity, synthetic isolation flags, pre-child archive/target drift rejection, durable validation, non-certification, and the create-only fresh-process CLI.
- No `.env`, real credential/session state, raw provider payload, or user OpenClaw state was read.

### Task 2: Implement the isolated probe and public durable route

- The implementation verifies every upstream byte boundary before executing the fixed fake-target observations used by tests.
- Child output is UTF-8 bounded, secret/path screened, normalized to facts, and then discarded; raw stdout/stderr never enters the artifact.
- Synthetic HOME deletion occurs on success and every failure path.
- Registry and artifact-contract validation recompute the fingerprint basis and reject partial or mutated evidence.

## Verification

| Gate | Result |
|---|---|
| `node --test test/package-inspect.test.js test/openclaw-probe.test.js test/phase4-contracts.test.js` | 13 pass, 0 fail |
| `node --test test/artifact-contract.test.js test/artifact-admission.test.js test/artifact-subjects.test.js test/cli.test.js` | 53 pass, 0 fail |
| `node --check` for the six modified/new production modules | pass |
| `git diff --check` | pass |

The full aggregate suite was intentionally not run because Plan 04-05 and the operator require the bounded Wave 5 gate plus necessary adjacent checks.

## Certification Boundary

This plan proves bounded compatibility mechanism observation only:

- `readOnlyCapabilityObservation: true`
- `installed: false`
- `pluginLoaded: false`
- `mcpConnected: false`
- `agentInvoked: false`
- `scheduleTriggered: false`
- `credentialsUsed: false`
- `runtime: false`
- `domain: false`
- `birth: false`
- `delivery: false`
- `production: false`

No live or user OpenClaw target was invoked or modified. Test subprocesses used only disposable synthetic target trees and synthetic HOME/state/config/workspace roots.

## Decisions Made

- Kept exact selected target/carrier and descriptor digests as the default public CLI authority while retaining explicit digest options for isolated fixtures and future exact reapproval tests.
- Separated the dependency-light probe identity/validator into `src/openclaw-probe-contract.js` to remove the artifact-registry/package-inspection ESM initialization cycle without weakening fingerprint recomputation.
- Rejected raw stdout/stderr persistence; only normalized kind, field names, byte length, and content digest participate in the fingerprint.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Removed an ESM initialization cycle**

- **Found during:** Task 2 exact Wave 5 gate
- **Issue:** Registry import of the production probe validator cycled through package inspection back to the registry.
- **Fix:** Moved only the schema identity and pure validator into `src/openclaw-probe-contract.js`; `src/openclaw-probe.js` re-exports the planned public API.
- **Files modified:** `src/openclaw-probe-contract.js`, `src/openclaw-probe.js`, `src/artifact-registry.js`, `src/artifact-contract.js`
- **Commit:** Not created; Git writes were explicitly prohibited for this execution.

**2. [Rule 3 - Blocking] Updated closed-surface contract expectations**

- **Found during:** Task 2 bounded adjacent verification
- **Issue:** Existing exact-list tests correctly rejected the newly registered artifact, contract subject, command, and help surface until their closed expectations were extended.
- **Fix:** Added only the Plan 04-05 subject/identity/command/help expectations and production-validator assertion.
- **Files modified:** `test/artifact-admission.test.js`, `test/artifact-contract.test.js`, `test/artifact-subjects.test.js`, `test/cli.test.js`
- **Commit:** Not created; Git writes were explicitly prohibited for this execution.

### AGENTS.md-Driven Adjustment

- Updated `release/2026.07.29.md` because this plan changes runtime compatibility evidence and certification boundaries.
- Did not run the full `npm run check`; the operator explicitly constrained verification to the Wave 5 gate plus bounded adjacent checks.
- Did not stage or commit any file because the operator explicitly prohibited all Git writes.

## Known Stubs

None. The probe, production validator, registry, subject mapping, CLI writer, formatter, and tests are wired to real bounded data sources; no placeholder data blocks the plan goal.

## Threat Review

- T-04-16: archive and target paths are external-digest bound, no-follow read, exact-member checked, and normalized before fingerprinting.
- T-04-17: child execution uses fixed executable/argv arrays, `shell:false`, a timeout, output bounds, and no inherited environment.
- T-04-18: HOME/state/config/workspace are synthetic and disposable; operator-state sentinel bytes remain unchanged.
- T-04-19: plugin status is manifest-only and MCP is explicitly unsupported; neither route is loaded or connected.
- No security-relevant surface beyond the plan threat model was introduced.

## Git Status

No commits were created. This execution obeyed the explicit prohibition on staging, committing, pushing, stashing, resetting, checkout, or switch. Existing shared-worktree changes were preserved.

## Next Phase Readiness

- Later package preview/approval work can bind the exact `fingerprintDigest` together with the exact D-42 and target/carrier authority digests.
- Any archive, target member, CLI/JSON output, runtime, policy/config, permission, or package conflict change invalidates the fingerprint.
- Installation, plugin activation, MCP, credentials, schedules, agent invocation, runtime/domain evaluation, Birth, Delivery, and production remain separate fail-closed transitions.

## Self-Check: PASSED

- All four declared created files exist.
- The planned public exports are present.
- Exact D-42, target/carrier admission, and target descriptor bytes match the recorded SHA-256 values.
- Both bounded verification gates, production module syntax checks, and final `git diff --check` passed.
- Commit verification is not applicable because Git writes were explicitly prohibited.
