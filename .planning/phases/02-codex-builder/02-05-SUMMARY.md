---
phase: 02-codex-builder
plan: "05"
subsystem: builder-package-runtime
tags: [codex-plugin, packed-runtime, receipt-ownership, external-trust-anchor, diagnostic-only]
requires:
  - phase: 02-codex-builder
    plan: "04"
    provides: [receipt-last projection, ownership-safe lifecycle, packed mechanism evidence]
provides:
  - fixed release-owned plugin and project-local runtime asset inventory
  - statically admitted transitive relative ESM import closure from bin/agentmo.js
  - receipt-managed project-local Builder launcher used by the installed skill
  - externally anchored projected-package admission and bounded diagnostic inspection
affects: [02-06-host-activation, builder-lifecycle-fixtures, codex-builder-uat]
tech-stack:
  added: []
  patterns: [fixed source-to-destination inventory, external receipt anchor, parent identity ledger, non-authoritative quarantine]
key-files:
  created:
    - test/builder-package-security.test.js
    - test/builder-install-security.test.js
  modified:
    - src/builder-package.js
    - src/builder-install.js
    - src/builder-doctor.js
    - src/cli.js
    - plugin/skills/agentmo/SKILL.md
    - test/builder-doctor.test.js
    - test/builder-lifecycle.test.js
    - test/builder-packed-install.test.js
    - test/helpers/io-surface-inventory.js
key-decisions:
  - "Projected executable admission requires an exact caller-provided receipt digest; local receipt, marker, and assets cannot certify themselves."
  - "Repeat setup requires the externally admitted prior receipt digest and binds project, release, receipt, file, and parent identities into one approval."
  - "Doctor uses a diagnostic-only non-executable view for broken projections and never upgrades observations into trust or support."
  - "Receipt rollback removes the canonical success path by atomic rename and leaves the non-authoritative quarantine untouched instead of deleting through a mutable pathname."
patterns-established:
  - "Runtime closure: fixed allowlist plus static graph equality; missing, expanded, remapped, traversing, duplicate, symlinked, or hard-linked inputs fail closed."
  - "Skill entry: invoke node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js, never a bare global agentmo command."
  - "Projection evidence: projected/declared proves bounded wiring only; activation, host behavior, domain quality, and production readiness remain false."
requirements-completed: []
requirements-pending: [BLDR-01]
coverage:
  - id: D1
    description: "The packed release admits one deterministic complete local ESM closure and rejects hostile inventory or source changes."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#fixed runtime inventory and hostile closure admission"
        status: pass
      - kind: other
        ref: "npm pack --dry-run --json --cache /tmp/agentmo-npm-cache-02-05-final-20260716"
        status: pass
    human_judgment: false
  - id: D2
    description: "Setup projects the co-released runtime receipt-last and the installed skill runs only its project-local launcher without global PATH dependence."
    requirement: BLDR-01
    verification:
      - kind: integration
        ref: "test/builder-packed-install.test.js#project-local launcher from packed bytes"
        status: pass
      - kind: other
        ref: "npm run check"
        status: pass
    human_judgment: true
    rationale: "The packed launcher and lifecycle mechanisms pass; official Codex install/enable and host observation remain explicitly deferred to 02-06."
duration: multi-pass implementation and hostile remediation
completed: 2026-07-16
status: complete
---

# Phase 2 Plan 05: Project-local Packed Runtime Summary

**A packed AgentMo release now projects a receipt-owned local Builder runtime that is runnable without the checkout or global PATH, while projected evidence remains distinct from Codex host activation.**

## Accomplishments

- Built one deterministic 57-asset inventory: five Codex plugin assets plus `package.json`, `bin/agentmo.js`, and the 51 JavaScript modules in the launcher's relative ESM closure.
- Added lexical import-graph admission and negative coverage for missing/unlisted imports, contextual syntax, traversal, remapping, symlinks, hard links, and duplicate destinations.
- Bound release assets, project scope, externally admitted prior receipt, receipt identity, and parent-directory identities into preview/apply authority; repeat setup without that receipt digest now fails closed.
- Revalidated the authorized parent ledger during staging, publication, and terminal verification. Failed receipt-last publication atomically removes the canonical receipt into a retained non-authoritative quarantine without pathname deletion.
- Required an external receipt digest before normal projected package admission, closing local receipt/marker/assets self-certification.
- Added a diagnostic-only doctor path that reports missing, corrupt, or modified installed projections without loading executable bytes or claiming support.
- Routed the installed skill through `node ./plugins/agentmo/runtime/agentmo/bin/agentmo.js` and kept activation, host behavior, and domain-quality evidence false.

## Review and Verification

- Independent final review: `.planning/phases/02-codex-builder/02-05-REVIEW.md` — **CLEAN**, CR-03 through CR-07 closed.
- Focused package/install/doctor/lifecycle gate — 57/57 pass across 5 suites.
- `node --test test/artifact-surface-coverage.test.js` — 10/10 pass.
- `npm run check` — 540/540 pass across 59 suites.
- `npm pack --dry-run --json --cache /tmp/agentmo-npm-cache-02-05-final-20260716` — pass, 58 packed files.
- `git diff --check` — pass.

## Evidence Boundary

This plan proves deterministic packed bytes, ownership-safe project projection, local launcher execution, read-only diagnosis, and bounded lifecycle mechanics. It does not prove that Codex installed, enabled, trusted, or invoked the plugin, and it does not certify Agent Package quality, domain quality, production readiness, or deployment approval.

## Commits

None — the user did not authorize staging or commits.

## Next Phase Readiness

Plan 02-05 is complete. BLDR-01 remains pending because official Codex user-host activation, selector ownership/consumption, and real host visibility belong to 02-06. Hook-to-checkpoint integration and authenticated UAT remain later gap plans.

---
*Phase: 02-codex-builder*
*Completed: 2026-07-16*
