# AI Frontier OpenClaw POC v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` task-by-task.

**Goal:** Generate a rich, inspectable OpenClaw-style information-agent POC with local-only knowledge and inert cron proposals.

**Architecture:** Extend only the `agentmo poc` lane. `src/poc-agent.js` owns deterministic workspace materialization and `src/poc-openclaw-runtime.js` retains a closed isolated runtime surface.

**Tech Stack:** Node.js ESM, Node test runner, existing persistability helpers.

## Global Constraints

- Work only in the linked worktree on `codex/poc-openclaw-builder`.
- Never read, print, persist, or copy `.env` values.
- Never fetch, start/register cron, deliver a message, or modify a default/user OpenClaw profile.
- Do not commit without explicit user instruction.

### Task 1: Agent documents and Skills

**Files:** Modify `src/poc-agent.js`; modify `test/poc-agent.test.js`.

- [ ] Write a failing test requiring `IDENTITY.md`, `USER.md`, `TOOLS.md`, `HEARTBEAT.md`, and six additional focused `skills/*/SKILL.md` files.
- [ ] Run `node --test test/poc-agent.test.js`; it must fail because the v2 files do not exist.
- [ ] Add fixed renderers. Every Skill specifies allowed local input, expected output, and prohibits network/publication/config mutation.
- [ ] Re-run `node --test test/poc-agent.test.js`; it must pass.

### Task 2: Knowledge indexes and inert cron proposals

**Files:** Modify `src/poc-agent.js`; modify `test/poc-agent.test.js`.

- [ ] Write failing tests for `knowledge/source-index.json`, `knowledge/entity-index.json`, three `cron/*.json` proposals, and `scripts/cron.mjs`.
- [ ] Run `node --test test/poc-agent.test.js`; it must fail because those files do not exist.
- [ ] Implement closed records such as `{ schemaVersion: "agentmo.poc-cron-proposal.v1", mode: "proposal-only", executionAuthority: "none" }`.
- [ ] `cron.mjs` accepts only `check` and `dry-run`; it contains no `fetch`, `spawn`, or scheduler registration.
- [ ] Re-run `node --test test/poc-agent.test.js`; it must pass.

### Task 3: v2 workspace integrity

**Files:** Modify `src/poc-agent.js`; modify `test/poc-agent.test.js`; modify `test/poc-cli.test.js`.

- [ ] Write a failing test that removes `knowledge/source-index.json` after build and expects `AGENTMO_POC_WORKSPACE_INVALID`.
- [ ] Run focused POC tests; it must fail because current check does not close the v2 file set.
- [ ] Add a versioned manifest inventory and fail-closed checks for every generated path and deterministic index binding.
- [ ] Re-run focused POC tests; they must pass.

### Task 4: Runtime regression boundary and release evidence

**Files:** Modify `test/poc-openclaw-runtime.test.js`, `test/helpers/io-surface-inventory.js`, and `release/2026.08.05.md`; modify runtime code only if a test exposes scope drift.

- [ ] Add an assertion that generated v2 content does not add `--deliver`, cron, browser, or collection argv.
- [ ] Update exact I/O inventory rows and release evidence without runtime transcripts or credential values.
- [ ] Run `node --test test/poc-agent.test.js test/poc-cli.test.js test/poc-openclaw-runtime.test.js`, `AGENTMO_TEST_LANE=main node --test test/artifact-surface-coverage.test.js`, `npm run check`, and `git diff --check`.
