# Spike Conventions

Patterns established by the Phase 2 gap architecture spikes.

## Stack

- Node.js ESM with built-in modules only.
- `node:test` for protocol and packed integration checks.
- Real installed Codex CLI for host-surface facts; always with isolated temporary `HOME` and `CODEX_HOME`.

## Structure

- Each spike lives under `.planning/spikes/NNN-name/` with runnable code and a result README.
- Runtime fixtures create all mutable state under a newly absent temporary root.
- Output and committed findings contain bounded codes/digests/booleans, never temporary paths or raw host state.

## Patterns

- Immutable journal entries use predecessor digests and exclusive publication; bounded loading rejects fork, gap, malformed published bytes, or conflicting terminal outcomes.
- Derived evidence is published as a content-addressed leaf first and becomes authoritative only when a later journal entry references its digest.
- Preview and mutation are separate commands. Preview is read-only; mutation requires exact values obtained from preview.
- Packed verifiers self-check their embedded version/release/verifier identity and the supplied tarball digest before evaluating evidence.
- Host-global resources use a stable user-owned source plus explicit consumer references; a project directory never owns the shared source location.

## Tools & Libraries

- Prefer Node built-ins, `npm pack --json`, system `tar`, and the installed `codex` CLI.
- Do not add dependencies, read `.env`, reuse real user host state, or treat a deterministic spike as domain/production certification.
