---
phase: 03-build-contract
plan: "01"
subsystem: bounded-live-discovery
tags: [discover, https, provenance, ssrf, fail-closed]
provides:
  - Public exact-digest `discover-live` command
  - Bounded HTTPS transport with manual redirects and public-address enforcement
  - Raw-byte-derived provenance and atomic Stage 1 artifact-set publication
affects: [03-02-normalization, 03-03-approval, 03-06-composed-gate]
requirements-completed: []
completed: 2026-07-28
status: complete-uncommitted
---

# Phase 03 Plan 01: Bounded Live Discovery Summary

`discover-live` now turns an exact-admitted, live-enabled discovery manifest into source-derived Stage 1 artifacts without treating retrieval as semantic, domain, runtime, or production certification.

## Delivered

- Added a versioned optional `collector` block to `agentmo.discovery.v1`; legacy manifest materialization and local workspace intake remain compatible.
- Added a production HTTPS transport with exact URL allowlisting, manual redirects, pinned DNS results, public-address checks, bounded headers, count/byte/deadline/content-type/status limits, and no retry surface.
- Hashes the exact bounded response bytes before UTF-8 decoding, redaction, summarization, or confidence derivation.
- Persists separate declared trust, retrieval evidence class, unverified confidence, rationale, requested/final URL, retrieval time, and exact content digest.
- Publishes discovery DB, facts, coverage, source cards, source chunks, and retrieval records through one absent-root transaction after whole-set preflight.
- Added the public CLI route, digest subject, help, package/runtime inventory, output ownership, and exact I/O inventory entries.

## TDD and verification

- RED: the two new suites initially failed with `ERR_MODULE_NOT_FOUND` for `src/discovery-live.js`.
- Live/security suite: 11/11 pass, including slow-body timeout and public CLI admission rejection.
- Focused Stage 1, contract, command, I/O, and stage-independence aggregate: 82/82 pass.
- Packed runtime inventory correction: isolated exact test 1/1 pass; the three live-discovery modules are present in the installed Builder runtime closure.
- `git diff --check`: pass.
- One full `npm run check` completed 777 tests: 775 pass, 1 fail, 1 skip. The sole failure was the fixed inventory count still expecting 69/64 rather than 72/67; after correcting that exact assertion, its isolated packed test passed. The approximately 20-minute aggregate was not repeated.

## Boundaries

- Automated tests use injected deterministic transport and do not access the Internet.
- No real source, `.env`, OpenClaw runtime, Wiki, scheduler, deduplicator, RAG store, or domain answer was exercised.
- The CLI exposes no transport override or credential-bearing option.
- No commit or push was created; the implementation remains in the current worktree pending explicit authorization.

## Next

Plan 03-02 should consume these retrieval records to add deterministic normalization, deduplication, freshness, conflict, and coverage-gap semantics without promoting mechanism evidence into quality claims.
