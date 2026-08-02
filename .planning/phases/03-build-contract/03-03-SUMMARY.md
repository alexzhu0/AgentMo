---
phase: 03-build-contract
plan: "03"
subsystem: discovery-approval
tags: [approval, exact-digest, plan, admission, fresh-process]
requires:
  - 03-02 normalized discovery evidence
provides:
  - Exact manifest/database approval preview and apply boundary
  - Mandatory four-artifact Plan admission
  - Public command, package, documentation, and I/O closure
affects: [03-04-decision-ledger, 03-05-build-contract, 03-06-composed-gate]
requirements-completed: [DISC-06, PLAN-01]
completed: 2026-07-28
status: complete-uncommitted
---

# Phase 03 Plan 03: Exact Discovery Approval Summary

AgentMo now requires explicit local approval of one exact discovery manifest and one exact derived Discovery DB before Plan can consume that evidence.

## Delivered

- Added `agentmo.discovery-approval.v1` with canonical manifest/database provenance tuples and an enter-Plan-only certification boundary.
- Added `agentmo discovery-approve`: preview is deterministic and write-free; apply requires `--approve`, the exact preview digest, and an absent output path.
- Registered approval as a companion-bound durable artifact. A parsed object, forged clone, DB status flag, command history, or sidecar cannot provide authority.
- Removed the public unapproved `design-plan` path. Plan now independently exact-admits the manifest, DB, approval, and user need in a fresh process.
- Added npm package, installed Builder runtime, help, command-subject, artifact registry, documentation, and exact I/O inventory closure.

## Verification

- RED: the new approval module and CLI were absent, while the old two-input Plan route still succeeded.
- GREEN: approval, Plan, blueprint draft, artifact admission, persistability, command, subject, I/O, MVP, and stage-contract aggregate passed 90/90.
- Packed Builder approval inventory passed 1/1 with 76 total assets and 71 runtime assets.
- npm package dry run included `src/discovery-approval.js`.
- The bounded full aggregate reached 763 pass, 0 fail, 1 skip before two unrelated long legacy suites were cancelled by explicit interruption; it is not reported as a full green run.
- No network, `.env`, credential, OpenClaw process, or user-level configuration was accessed.

## Boundaries

- Approval proves explicit local operator intent for the `enter-plan` transition only.
- It does not authenticate an organization or certify source quality, semantic relevance, runtime, package, domain, production, or deployment readiness.
- Changes remain local and uncommitted; no push or publication occurred.

## Next

Plan 03-04 should add the append-only decision ledger over approved research and planning decisions.
