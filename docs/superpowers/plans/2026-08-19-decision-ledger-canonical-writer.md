# Decision Ledger Canonical Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Publish a documented, create-only Plan Decision Entry canonicalizer that normalizes unapproved drafts before digest authority, then bind its shipped implementation to fresh Node 20 evidence.

**Architecture:** Keep canonicalization outside append/admission: a private, verified 0600 stage receives normalized bytes, then one create-only hard link publishes them to an absent output. The public model requires a caller-owned non-group/world-writable parent and excludes concurrent same-UID mutation of the output parent, private stage, or target namespace while the command runs. Append and admission remain strict readers of already-bound bytes.

**Tech Stack:** Node.js ESM, Node `fs/promises`, AgentMo artifact contracts, the repository-owned Node 20 trusted-lane receipt.

**Spec:** `AGENTS.md`; `docs/MVP_RUNBOOK.md`; approved controller direction dated 2026-08-19.

## Global Constraints

- Do not read `.env`, alter POC artifacts, commit, push, open a PR, tag, or release.
- Do not add native code, native transactions, or dependencies.
- Do not widen append, admission, digest, predecessor, decisionRefs, or artifact-admission authority.
- Public errors remain bounded and value-blind.
- Never claim protection against excluded same-UID concurrent `link`, `rename`, `unlink`, or write mutation.
- Run the trusted Node 20 producer only into a new absent temporary receipt and publish exact successful bytes afterward.

---

### Task 1: Narrow the canonical writer to its public single-writer contract

**Files:**
- Modify: `src/decision-entry-canonicalizer.js`
- Modify: `test/decision-ledger.test.js`
- Modify: `test/artifact-surface-coverage.test.js`
- Modify: `test/helpers/io-surface-inventory.js`

**Interfaces:**
- Consumes: `canonicalizeDecisionEntryDraft(value)`, `readBoundedNoFollowFile`, and `serializePersistableJson`.
- Produces: `canonicalizeDecisionEntryFile({ entryPath, outPath })`, which returns only schema, identity, subject, and exact-byte digest.

- [ ] **Step 1: Write RED tests for the narrowed public contract**

Keep fresh-CLI tests for unordered unique refs becoming a separate canonical file, exact reported digest, pre-existing output byte preservation, output/draft symlink rejection, duplicate JSON-member rejection, and no output for invalid input. Remove test-only concurrent same-UID hook scenarios because they are explicitly outside the contract.

- [ ] **Step 2: Run the focused RED suite**

Run: `node --test test/decision-ledger.test.js`

Expected: the new contract/documentation assertions fail before writer simplification, while retained append/lineage tests remain meaningful.

- [ ] **Step 3: Implement the minimum private-stage writer**

Verify canonical bytes on the retained stage FD while it has one link. Revalidate the safe parent immediately before `link(stage.entryPath, outPath)`. Make that create-only `link` the last fallible public-output operation; stage cleanup may only touch the verified private stage. Remove post-link hooks, post-link invalidation, and assertions that imply same-UID race atomicity.

- [ ] **Step 4: Run GREEN and reconcile exact I/O ownership**

Run: `node --test test/decision-ledger.test.js test/artifact-contract.test.js test/command-docs.test.js test/artifact-surface-coverage.test.js`

Expected: exit 0, exact scanner/allowlist parity, and no public rollback-unlink surface.

### Task 2: Publish the narrowed public contract

**Files:**
- Modify: `README.md`
- Modify: `docs/MVP_RUNBOOK.md`
- Modify: `docs/STAGE_CONTRACTS.md`
- Modify: `test/artifact-contract.test.js`

**Interfaces:**
- Consumes: CLI help spelling `--expected-head-digest`, Decision Entry schema field order rule, and Task 1 writer behavior.
- Produces: one documented canonicalize-before-digest flow and explicit single-writer threat-model boundary.

- [ ] **Step 1: Write RED documentation/help assertions**

Require the public contract to name `canonicalize-entry`, `--expected-head-digest`, byte-sorted `sourceRefs`, `decisionRefs`, and `requirementRefs`, and the excluded concurrent same-UID namespace mutation model. Require `--expected-head-sha256` rejection by Plan ledger.

- [ ] **Step 2: Run RED**

Run: `node --test test/artifact-contract.test.js test/command-docs.test.js`

Expected: failure until the public text stops promising post-publication inode invalidation.

- [ ] **Step 3: Update bounded docs and help**

State that stage verification occurs before digest/report authority, link publication is absent-only, and observable pre-publication anomalies reject. State the excluded same-UID mutation boundary without values, host paths, or raw artifacts.

- [ ] **Step 4: Run GREEN**

Run: `node --test test/artifact-contract.test.js test/command-docs.test.js`

Expected: exit 0.

### Task 3: Extend Node 20 ownership and produce new evidence

**Files:**
- Modify: `scripts/node20-core-receipt.js`
- Modify: `test/node20-core-runner.test.js`
- Modify: `test/runtime-evidence-consumers.test.js`
- Modify: `test/helpers/io-surface-inventory.js`
- Create after producer success: `release/evidence/2026.08.19-node20-core-receipt.json`
- Modify: `docs/CURRENT_STATUS.md`, `docs/RUNTIME_COMPATIBILITY.md`, `release/2026.08.19.md`, `release/README.md`

**Interfaces:**
- Consumes: repository-owned Node 20 distribution trust anchor and a new absent temporary receipt path.
- Produces: syntax ownership of `src/decision-entry-canonicalizer.js`, a new command-set digest, and exact published evidence consumers while preserving historical receipts byte-for-byte.

- [ ] **Step 1: Write RED manifest/consumer assertions**

Require the canonicalizer in `SYNTAX_FILES`, syntax expected count 43, and consumer facts for a new dated receipt. Refresh affected line-addressed I/O entries only from the scanner.

- [ ] **Step 2: Run RED**

Run: `node --test test/node20-core-runner.test.js test/runtime-evidence-consumers.test.js test/artifact-surface-coverage.test.js`

Expected: failure because the previous receipt/digest and dated evidence are intentionally stale.

- [ ] **Step 3: Run the trusted producer into a new absent temporary receipt**

Validate the pinned archive/checksum inputs through the repository-owned lane, then run `npm run check:core:node20 -- ... --receipt <new-absent-temp>`. Stop and publish nothing on any nonzero producer exit.

- [ ] **Step 4: Publish exact successful bytes and update consumers**

Validate the temporary receipt using `readNode20Receipt`, add identical bytes as the new dated evidence file, record its SHA-256 and measured command-set digest/counts, and retain historical receipt bytes unchanged. Run post-publication consumers only after the exact file exists.

- [ ] **Step 5: Run GREEN**

Run: `node --test test/node20-core-runner.test.js test/node20-core-lane.test.js test/runtime-evidence-consumers.test.js test/artifact-surface-coverage.test.js`

Expected: exit 0 with the actual Node 20 lane conditionally skipped on the host and exact published evidence accepted.

### Task 4: Complete release closure and verification

**Files:**
- Review every changed path from Tasks 1–3.

**Interfaces:**
- Consumes: current public contract, exact Node 20 receipt, and release evidence.
- Produces: a value-blind handoff with no POC mutation.

- [ ] **Step 1: Run required Stage 2 and focused tests**

Run: `node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js`

Then run: `node --test test/decision-ledger.test.js test/artifact-contract.test.js test/command-docs.test.js test/artifact-surface-coverage.test.js test/builder-packed-install.test.js test/builder-package-security.test.js test/builder-shipped-test-control.test.js`

- [ ] **Step 2: Run full repository verification**

Run: `npm run check`

Then run: `git diff --check`

- [ ] **Step 3: Verify cleanup and handoff facts**

Check `git status --short`, package/Builder/tarball inventories, Node20 receipt SHA/counts, and ensure only known temporary test paths were removed. Provide a recovery prompt for the POC; do not execute it.
