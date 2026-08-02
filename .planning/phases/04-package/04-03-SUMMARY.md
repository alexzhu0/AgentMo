---
phase: 04-package
plan: "03"
subsystem: package-produce
tags: [deterministic-package, openclaw, native-plugin, d42-archive, fail-closed]
requires:
  - phase: 04-package
    plan: "02"
    provides: Exact recipe-bearing build contract, plan approval, target descriptor, and human-selected target/carrier admission
provides:
  - Complete canonical Agent Package directory from exact admitted authority
  - OpenClaw-native workspace, skill, policy, memory, eval, proposal, and recipe-derived plugin resources
  - Deterministic D-42 archive with external, manifest, inventory, and member closure
  - Fresh-process package-produce CLI with exact digest bindings
affects: [04-04-package-inspect, package-preview, package-approval, package-apply]
tech-stack:
  added: []
  patterns:
    - Validate full exact authority before absent-root staging
    - Commit canonical directory before deriving the sole D-42 transport
    - Materialize executable plugin bytes only from admitted inline recipe content
key-files:
  created:
    - src/package-produce.js
    - src/package-archive.js
    - src/targets/openclaw-package.js
    - test/package-produce.test.js
    - test/package-determinism.test.js
    - test/openclaw-package.test.js
    - .planning/phases/04-package/04-03-agent-package
    - .planning/phases/04-package/04-03-agent-package.d42
    - .planning/phases/04-package/04-03-SUMMARY.md
  modified:
    - src/artifact-subjects.js
    - src/cli.js
    - test/phase4-contracts.test.js
    - release/2026.07.29.md
key-decisions:
  - "The canonical directory is build authority; sha256:7726d7b635a972403c598bf53eeb9c44a75c57ffd5c4a573470a066a798b955f is the sole D-42 preview/approval/apply transport for this exact output."
  - "Native plugin members are rendered byte-for-byte from nativePluginRecipe.files only; caller paths, bytes, templates, environment, clocks, locale, and randomness are not package inputs."
  - "Package evidence keeps install, activation, credential write, schedule execution, runtime, domain, Birth, production, publication, and deployment claims false."
patterns-established:
  - "Authority-before-output: all eight named artifacts and semantic cross-bindings validate before the stage directory exists."
  - "D-42 closure: archive digest binds canonical manifest bytes, canonical member inventory, and each member's path/type/mode/length/content digest."
requirements-completed: [PACK-01, PACK-02, PACK-03, PACK-04]
coverage:
  - id: D1
    description: "A fresh process re-admits the exact authority chain and produces the complete canonical Agent Package."
    requirement: PACK-01
    verification:
      - kind: integration
        ref: "test/package-produce.test.js#works from a fresh CLI process using only exact named artifacts"
        status: pass
      - kind: integration
        ref: "exact 04-02 authority package-produce CLI invocation"
        status: pass
    human_judgment: false
  - id: D2
    description: "OpenClaw projection contains complete declarative resources and exact recipe-derived plugin bytes with no MCP surface."
    requirement: PACK-03
    verification:
      - kind: integration
        ref: "test/openclaw-package.test.js#projects complete OpenClaw-native resources and only recipe-derived plugin bytes"
        status: pass
      - kind: integration
        ref: "phase-local package MCP absence scan"
        status: pass
    human_judgment: false
  - id: D3
    description: "The deterministic D-42 archive binds the manifest, canonical inventory, and full 40-member closure."
    requirement: PACK-04
    verification:
      - kind: integration
        ref: "test/package-determinism.test.js"
        status: pass
      - kind: integration
        ref: "readPackageArchiveInventory over phase-local D-42 archive"
        status: pass
    human_judgment: false
duration: 19min
completed: 2026-07-29
status: complete
---

# Phase 4 Plan 3: Deterministic Agent Package Produce Summary

**Exact approved Phase 3/4 authority now materializes a 40-member canonical Agent Package and externally bound deterministic D-42 archive without crossing install or runtime boundaries**

## Performance

- **Duration:** 19 min
- **Started:** 2026-07-29T11:14:47Z
- **Completed:** 2026-07-29T11:33:45Z
- **Tasks:** 2/2
- **Package closure:** 40 indexed members plus `agentmo.package.json`

## Accomplishments

- Added `produceAgentPackage`, which re-admits all eight exact artifacts, revalidates every cross-binding and recipe digest, stages only absent outputs, and publishes the directory before deriving transport.
- Added a complete OpenClaw projection with workspace documents, a workspace skill, tool/policy bindings, memory and eval resources, proposal-only schedule and credential setup files, four hook mappings, and plugin bytes copied solely from the approved inline recipe.
- Added deterministic archive creation and retained inspection that reject archive digest, canonical encoding, manifest, inventory, member-set, type, mode, byte-length, content, link/device, duplicate, case/Unicode collision, extra, and missing-member drift.
- Added the `package-produce` CLI and exact durable subject closure, with fresh-process tests and digest-only output that persists no host path.
- Materialized the approved phase-local outputs:

  - `.planning/phases/04-package/04-03-agent-package`
  - `.planning/phases/04-package/04-03-agent-package.d42`

## Exact Output Evidence

| Evidence | Value |
|---|---|
| Selected target/carrier admission | `sha256:5549707121dc1753bfe00909c9dc26d59668de1408d7894b0ecb17340ebe2bf6` |
| Canonical recipe digest | `sha256:5bd43924237a304222f60a9788a8f0130819ba0208f567ebfc798b0735205402` |
| D-42 archive digest | `sha256:7726d7b635a972403c598bf53eeb9c44a75c57ffd5c4a573470a066a798b955f` |
| Manifest digest | `sha256:af98b46e5d5d5a6e46db7c7b020fea51115bae0829d943583ce9d756ce1d1c45` |
| Inventory digest | `sha256:d6be393fc176c9f28811e9e8771fae7cff5efb81a824697a6300ae80466c32a5` |
| Indexed members | 40 |
| Archive bytes | 113469 |

## Task Commits

No Git commits were created because the repository contract requires explicit authorization and the execution assignment prohibited Git mutations.

1. **Task 1: Lock the executable package and archive contract with RED tests** — `not-created — user authorization required`
2. **Task 2: Implement exact Produce, OpenClaw projection, D-42 transport, and CLI** — `not-created — user authorization required`

**Plan metadata:** `not-created — user authorization required`

## Files Created/Modified

- `src/package-produce.js` — exact source admission, authority revalidation, resource graph materialization, staged directory publication, and archive handoff.
- `src/package-archive.js` — deterministic archive encoder plus no-follow complete-closure reader.
- `src/targets/openclaw-package.js` — OpenClaw-native workspace/config/proposal/plugin projection.
- `src/artifact-subjects.js` — exact eight-subject `package-produce` digest closure.
- `src/cli.js` — public create-only package production command and digest report.
- `test/package-produce.test.js` — success, zero-output failure, recipe drift, and fresh-process CLI coverage.
- `test/package-determinism.test.js` — dual-root deterministic bytes and archive mutation matrix.
- `test/openclaw-package.test.js` — complete native projection and exact recipe-member comparison.
- `test/phase4-contracts.test.js` — Wave 3 public service and non-certification gate.
- `release/2026.07.29.md` — architecture/release evidence for the new package semantics.

## Decisions Made

- The manifest excludes itself from its member inventory to avoid a digest cycle; the archive binds the manifest digest externally and transports the canonical manifest bytes separately.
- The archive uses deterministic canonical JSON and base64 member contents. The retained reader recomputes every descriptor and rejects non-canonical or incomplete transport.
- The package result returned by the service may identify local outputs, while the public CLI emits only portable digests and false certification boundaries so no host path becomes durable output.
- Fixed package modes are `0644` or `0755`; package input and archive readers reject links, devices, hard links, unsafe paths, and incomplete closures.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Boundary bug] Removed a declarative MCP field from the projection**

- **Found during:** Task 2 post-build boundary scan
- **Issue:** The capability-map projection included `"mcp": false`. It granted no route, but the approved package requires no MCP server, config, registration, or activation surface at all.
- **Fix:** Removed the field, deleted only the two outputs created during this turn, and rebuilt them from the exact approved authority.
- **Files modified:** `src/targets/openclaw-package.js` and the two phase-local generated outputs.
- **Verification:** Recursive package scan returned no MCP occurrence; focused and adjacent gates remained green.
- **Commit:** `not-created — user authorization required`

**2. [Rule 1 - Performance bug] Avoided persistability re-auditing of base64 archive content**

- **Found during:** Task 2 focused GREEN gate
- **Issue:** Re-running generic sensitive-text regex auditing over already validated base64 member payloads made each small package build take roughly 25 seconds.
- **Fix:** Kept persistability audits on every source resource and product text, then encoded the already validated archive envelope directly as canonical JSON. The retained reader still verifies external digest, canonical bytes, manifest, inventory, and every member.
- **Files modified:** `src/package-archive.js`.
- **Verification:** Identical functional gates dropped below one second per build while archive mutation tests continued to fail closed.
- **Commit:** `not-created — user authorization required`

**Total deviations:** 2 Rule 1 auto-fixes. Both tightened correctness or bounded performance without broadening scope.

## Verification

- RED gate: expected `ERR_MODULE_NOT_FOUND` for the absent package producer/archive modules; wrapper exit 0 with underlying test failure.
- Focused GREEN gate: 10/10 passed after adding the fresh-process CLI case.
- Wave 3 adjacent gate: 30/30 passed, 0 failed, 0 cancelled, 0 skipped.
- Syntax checks: `node --check` passed for all five production modules.
- Exact phase-local archive inspection: 40/40 members; archive, manifest, and inventory digests matched the values above.
- MCP absence scan: no match in the generated package directory.
- Stub scan: no blocking placeholder, empty mock data source, TODO, or FIXME in changed production/test files.
- `git diff --check`: passed.
- The long aggregate `npm run check` was intentionally not run; the approved plan requires bounded Phase 3/4 gates and explicitly defers the full suite.

## Known Stubs

None. Default parameters and validation error accumulators found by the mechanical scan are functional code, not product stubs.

## Threat Review

- **T-04-05:** exact target/carrier admission and all source digests are re-admitted before output.
- **T-04-06:** plugin bytes are derived solely from normalized recipe content; no caller path, caller bytes, MCP, or automatic install authority is accepted.
- **T-04-07:** only the exact selected admission digest authorizes production.
- **T-04-08:** portable paths, fixed modes, no-follow reads, link/device/hard-link rejection, collision checks, and complete directory/archive closure are enforced.
- **T-04-09:** no environment variable, clock, locale, uid/gid, template, or random value enters package bytes; random stage suffixes are ephemeral only.
- **T-04-10:** source objects and product text are persistability-audited before publication; no `.env`, secret value, raw provider payload, transcript, host path, or temp path is persisted.
- No security-relevant surface outside the plan's threat model was introduced.

## Certification Boundary

| Claim | Status |
|---|---|
| Exact package directory materialized | true |
| Deterministic D-42 archive materialized | true |
| Installed or user-level state modified | false |
| Plugin activated | false |
| Credential value written | false |
| Schedule registered or executed | false |
| OpenClaw runtime executed | false |
| Domain quality certified | false |
| Birth certified | false |
| Production certified | false |

## User Setup Required

None. Installation, activation, credential setup, and schedule registration remain separate unauthorized future transitions.

## Next Phase Readiness

Plan 04-04 can inspect only the exact D-42 archive digest recorded above. Any archive, manifest, inventory, member, target, approval, or recipe drift must require a new bounded authority decision; the directory must not be substituted as downstream transport.

## Self-Check: PASSED

- All declared production modules, tests, generated outputs, and this summary exist.
- Required exports are present.
- Manifest and archive raw SHA-256 values exactly match the recorded evidence.
- No task or metadata commit was expected or claimed.
- Final `git diff --check` passed.
