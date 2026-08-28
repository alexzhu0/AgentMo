# Design Plan Standalone Loader Cycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the public design-plan loader safe as the first AgentMo module imported in a fresh process, then bind that behavior to fresh trusted Node 20 and release evidence.

**Architecture:** Remove only the top-level cyclic schema-binding read from the durable registry, retain lazy synchronous validation after module initialization, and prove the contract in a fresh subprocess. Extend the existing fixed Node 20 core manifest with the real design-plan regression file and publish a new exact receipt through the existing trust anchor.

**Tech Stack:** Node.js ESM, Node test runner, AgentMo artifact admission and durable registry, repository-owned Node 20 trusted-lane receipt.

**Spec:** `docs/superpowers/specs/2026-08-28-design-plan-loader-cycle-design.md`; `AGENTS.md`; `docs/MVP_RUNBOOK.md`.

## Global Constraints

- Do not read `.env`, modify sibling projects, mutate POC artifacts, or replace the preserved lecture-study design-plan bytes.
- Do not commit, push, open a PR, tag, publish, create a GitHub Release, or approve/advance Plan, Produce, Package, install, activation, or runtime.
- Keep the loader API, schema identity, digest/subject admission, provenance, and validation semantics unchanged and fail-closed.
- The regression child must import `src/design-plan.js` first, use the real loader, emit only bounded value-blind evidence, and have bounded lifecycle cleanup.
- Do not add dependencies or a new source module.
- Run the trusted Node 20 producer only into a new absent temporary receipt; publish those exact bytes only after producer success, then run consumers.
- Preserve all historical receipts byte-for-byte and describe new evidence as bounded mechanism evidence, never domain-quality or production certification.
- Use `apply_patch` for edits. Keep the controller-created design and plan documents.

---

### Task 1: Add the direct-first-import regression and remove the TDZ read

**Files:**
- Modify: `test/design-plan.test.js`
- Modify: `src/artifact-registry.js`

**Interfaces:**
- Consumes: `loadDesignPlan(filePath, { subject, expectedDigest })`, the exported design-plan schema identity, and the existing artifact-admission error codes.
- Produces: a fresh-process direct-first-import contract with exact success, wrong-digest rejection, and wrong-subject rejection.

- [ ] **Step 1: Add the real subprocess regression without changing production**

Create a bounded test helper that starts a fresh `process.execPath` Node child. Its first repository import must be `./src/design-plan.js`; it then calls `loadDesignPlan` on a real valid fixture written by the parent. Add three tests: exact subject/digest succeeds with `agentmo.design-plan.v1` and the fixture runtime, wrong well-formed digest rejects with `AGENTMO_ARTIFACT_DIGEST_MISMATCH`, and wrong subject rejects with `AGENTMO_UNSUPPORTED_ARTIFACT`. Do not expose the fixture path or raw plan in child output.

- [ ] **Step 2: Prove RED is the module TDZ defect**

Run: `node --test --test-name-pattern='standalone design-plan loader' test/design-plan.test.js`

Expected before production changes: nonzero with the fresh child failing at the current `DESIGN_PLAN_SCHEMA_VERSION` TDZ read, while the test harness itself remains bounded and syntactically valid.

- [ ] **Step 3: Apply the minimum registry fix**

In `src/artifact-registry.js`, remove `DESIGN_PLAN_SCHEMA_VERSION` from the cyclic import and set only the design-plan registry record identity to the stable public literal `agentmo.design-plan.v1`. Keep `validateDesignPlan` lazy and preserve every other registry record and admission rule.

- [ ] **Step 4: Prove GREEN and adjacent Stage 2 closure**

Run: `node --test --test-name-pattern='standalone design-plan loader' test/design-plan.test.js`

Then run: `node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`

Then run: `node --check src/artifact-registry.js && node --check test/design-plan.test.js && git diff --check`

Expected: exit 0, pristine output, no regression in the documented Stage 2 set.

### Task 2: Extend fixed Node 20 ownership and prepare evidence consumers

**Files:**
- Modify: `scripts/node20-core-receipt.js`
- Modify: `scripts/node20-core-lane.sh`
- Modify: `test/node20-core-runner.test.js`
- Modify: `test/runtime-evidence-consumers.test.js`
- Modify: `README.md`
- Modify: `docs/CURRENT_STATUS.md`
- Modify: `docs/RUNTIME_COMPATIBILITY.md`
- Modify: `release/README.md`
- Create: `release/2026.08.28.md`
- Create only after trusted producer success: `release/evidence/2026.08.28-node20-core-receipt.json`

**Interfaces:**
- Consumes: the fixed `test/design-plan.test.js`, `OWNED_COMMAND_MANIFEST`, repository-owned `scripts/node20-distribution-trust.json`, and the trusted Node 20.20.2 darwin-arm64 inputs selected by that trust anchor.
- Produces: exact Node 20-owned direct-loader evidence, a fresh dated receipt, and post-publication consumers/docs bound to its measured facts.

- [ ] **Step 1: Write RED ownership assertions**

Add `test/design-plan.test.js` to `CORE_TEST_FILES`. Update runner tests to require that exact member and the resulting expected test counts. Use the real number of design-plan tests after Task 1; do not guess counts or weaken TAP validation. First run the focused runner/consumer tests and record the intentional stale-receipt RED before publishing evidence.

Keep the non-authoritative inventory comment in `scripts/node20-core-lane.sh` synchronized with the fixed producer manifest; it must not become an alternate authority.

Run: `node --test test/node20-core-runner.test.js test/runtime-evidence-consumers.test.js`

Expected: nonzero because the old published receipt and consumer facts do not match the new command manifest.

- [ ] **Step 2: Verify the fixed current-host contract before trusted production**

Run: `node --test test/design-plan.test.js test/node20-core-runner.test.js test/node20-core-lane.test.js`

Run the documented Stage 2 set again if any Task 2 edit touches its test file. Stop on any failure; do not publish a receipt.

- [ ] **Step 3: Produce to a new absent temporary receipt**

Locate the already-approved Node 20.20.2 executable, official archive, and official checksum manifest without reading `.env`, searching `PATH`, downloading a runtime, or accepting caller-supplied trust. Confirm the destination does not exist, then invoke the repository-owned `check:core:node20` producer with the exact version/architecture and that absent receipt. The producer must exit 0 and its receipt must validate before publication.

- [ ] **Step 4: Publish exact bytes and close consumers**

Use `apply_patch` to add byte-identical successful receipt content as `release/evidence/2026.08.28-node20-core-receipt.json`. Compute its SHA-256. Update post-publication consumer constants, release index/current status/README/runtime matrix, and a new bounded `release/2026.08.28.md` record with exact measured observedAt, command-set digest, receipt SHA, counts, commands, status, and remaining certification boundary. Historical evidence files and facts remain historical, not overwritten.

- [ ] **Step 5: Run focused GREEN**

Run: `node --test test/node20-core-runner.test.js test/node20-core-lane.test.js test/runtime-evidence-consumers.test.js test/command-docs.test.js test/artifact-surface-coverage.test.js`

Then run: `git diff --check`

Expected: exit 0 with exact published evidence accepted and no surface/inventory drift.

### Task 3: Complete repository verification and POC handoff

**Files:**
- Review every path changed by Tasks 1–2 and the controller-created design/plan documents.

**Interfaces:**
- Consumes: the reviewed implementation, fresh exact receipt, release closure, and preserved POC design-plan digest `24bfd12176f0945958570e236347e6d0302e79149128b08b00edd5a26f416736`.
- Produces: final repository evidence and a recovery instruction that stops at the next human Plan gate.

- [ ] **Step 1: Run required focused gates**

Run the documented Stage 2 set:

`node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`

Run the Node 20 post-publication consumer set from Task 2 and `git diff --check`.

- [ ] **Step 2: Run the repository gate once**

Run: `npm run check`

Then run: `git diff --check`

Do not retry a failed full run without diagnosing its first failure or liveness state.

- [ ] **Step 3: Verify final state and handoff**

Check exact changed/untracked paths, receipt SHA/counts/digests, absence of secrets or absolute host paths in committed artifacts, and absence of unrelated changes. Confirm the original main worktree's pre-existing untracked document was neither read nor changed. Independently review the whole diff. If and only if there are no open Critical/Important findings, direct the POC session to verify the preserved design plan with a fresh direct import and continue only to the next explicit human Plan approval gate.
