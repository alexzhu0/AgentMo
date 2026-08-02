---
phase: 03-build-contract
plan: "02"
subsystem: provider-normalization
tags: [discover, web, github, arxiv, local, provenance, mechanical-observations]
requires:
  - 03-01 bounded live discovery transport and publication
provides:
  - Closed Web, GitHub REST, and arXiv metadata adapter registry
  - Common network/local discovery evidence vocabulary
  - Deterministic non-semantic dedup, freshness, conflict-candidate, and coverage-gap observations
affects: [03-03-approval, 03-04-decision-ledger, 03-06-composed-gate]
key-files:
  created:
    - src/collectors/web.js
    - src/collectors/github.js
    - src/collectors/arxiv.js
  modified:
    - src/discovery-live.js
    - src/discovery-provenance.js
    - src/discovery-source-workspace.js
    - src/design-plan.js
requirements-completed: [DISC-01, DISC-02, DISC-03, DISC-04, DISC-05]
coverage:
  - deliverable: Closed provider adapters and common canonical evidence fields
    verification:
      - kind: test
        ref: test/discovery-live.test.js
        status: pass
      - kind: test
        ref: test/discovery-source-workspace.test.js
        status: pass
    human_judgment: false
  - deliverable: Mechanical dedup, freshness, conflict candidates, and coverage gaps without semantic promotion
    verification:
      - kind: test
        ref: test/discovery-live.test.js
        status: pass
      - kind: test
        ref: test/design-plan.test.js
        status: pass
    human_judgment: false
  - deliverable: Package, Builder runtime, and static I/O closure
    verification:
      - kind: test
        ref: test/artifact-surface-coverage.test.js
        status: pass
      - kind: command
        ref: npm pack --dry-run --json
        status: pass
    human_judgment: false
completed: 2026-07-28
status: complete-uncommitted
---

# Phase 03 Plan 02: Provider Normalization Summary

AgentMo now normalizes bounded Web, GitHub REST, arXiv metadata, and approved local documents into a common evidence model while keeping collection mechanics separate from semantic or domain claims.

## Delivered

- Added a closed `DISCOVERY_COLLECTOR_ADAPTERS` registry for `web`, `github`, and `arxiv`; adapter choice is manifest-bound and cannot come from environment variables or a standalone provider command.
- GitHub uses fixed API version `2022-11-28`, fixed request headers, exact allowlisted `api.github.com` URLs, serial pagination capped at three pages, aggregate byte bounds, bounded rate/ETag/Last-Modified observations, and immediate 403/429 failure without retry or body persistence.
- arXiv accepts only the metadata query endpoint, extracts bounded Atom title/date/abstract fields, records a polite 3-second policy basis, and rejects PDF/e-print collection by default.
- Network and local records now expose separate provider kind/policy, evidence class, declared trust, retrieval status, confidence/rationale, original location, duplicate, freshness, conflict-candidate, coverage-gap, and mechanical observation fields.
- Exact content digests drive deterministic deduplication; freshness, conflict, and coverage results are explicitly `mechanical-non-semantic` and retain remaining uncertainty.
- Stage 2 ranks primary/first-party evidence ahead of context/community only as a deterministic display preference. Hostname, declared trust, provider metadata, and token overlap do not upgrade weak evidence into `supported`.
- Added the provider modules to npm packaging, Builder runtime inventory, syntax precheck, and exact static I/O closure.

## TDD and verification

- RED: focused tests failed on missing provider modules, missing local canonical fields, and absent non-semantic Plan matching metadata.
- GREEN: final focused Stage 1/Stage 2/I/O aggregate passed 80/80.
- Live/security provider slice passed 15/15.
- Static I/O inventory passed 17/17.
- Packed Builder runtime inventory passed 1/1 with 75 total assets and 70 runtime assets.
- `npm pack --dry-run --json` included all three provider modules.
- `git diff --check`: pass.
- Full `npm run check` reached two pre-existing load-sensitive `builder-codex-uat-prior-attempt` failures during the long parallel crash-recovery matrix and was stopped to avoid wasting the remaining long suite. Both exact failing cases then passed in isolation, 2/2 with exit code 0. No changed file overlaps that authority implementation.

## Commits

None. Repository instructions require explicit commit authorization; all Plan 03-01 and 03-02 work remains local and uncommitted.

## Boundaries

- Tests use injected transports; no live Internet source was fetched.
- No `.env` value, provider credential, unrestricted header bag, raw provider body, full paper, OpenClaw state, Wiki, scheduler, RAG store, or domain answer was persisted or executed.
- Evidence class and source preference do not certify truth, semantic relevance, domain quality, runtime success, or production readiness.
- The user's installed OpenClaw is recorded as available for later Phase 4/5 gates; Plan 03-02 did not inspect or mutate it.

## Next

Plan 03-03 should add exact two-digest human approval binding the source manifest and derived Discovery DB before Plan can consume live evidence.

## Deviations from Plan

- `src/discovery.js`, `src/artifact-contract.js`, their contract test, and Builder package inventory were also updated because supporting new closed adapter kinds and shipping their import closure is necessary for the planned public contract.
- The full aggregate is recorded as inconclusive under parallel load rather than falsely reported green; the two observed failures were independently reproduced as passing.

## Self-Check: PASSED

- Required provider modules exist and are packaged.
- All plan-focused acceptance tests pass.
- Exact I/O and public command closure passes.
- No commit, push, live network access, `.env` read, or OpenClaw mutation occurred.
