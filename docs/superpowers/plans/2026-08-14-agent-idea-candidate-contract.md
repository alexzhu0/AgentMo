# Agent Idea Candidate Contract Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a proposal-only, exact-Discovery-DB-bound Agent Idea Candidate artifact and read-only public report without granting or changing any Plan authority.

**Architecture:** A focused pure module owns Candidate shape validation and bounded reporting. Durable admission supplies one authentic Discovery DB companion so the registry can validate exact provenance and unique fact resolution. Existing Plan commands and schemas remain byte-for-byte interface compatible and never consume the Candidate.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, AgentMo exact-byte artifact admission, hand-maintained JSON Schema contracts, existing persistability and CLI output surfaces.

## Global Constraints

- Canonical identity is exactly `agentmo.agent-idea-candidate.v1`.
- Durable subject and module naming use exactly `agent-idea-candidate`.
- The Candidate contains no human decision, approval state, organization-authentication claim, Plan/build/runtime authority, or runtime-specific field.
- Every evidence ID must uniquely resolve in one exact admitted `agentmo.discovery-db.v1` companion.
- `extraction_field` citations are planning leads only and emit bounded insufficiency warnings.
- No Stage 2 command consumes or accepts the Candidate as authority.
- Do not read `.env`, access network services, install/activate runtime, push, merge, open a PR, tag, or create a GitHub Release.
- Use explicit paths for staging and commits.

---

### Task 1: Candidate validator and bounded report

**Files:**
- Create: `src/agent-idea-candidate.js`
- Create: `test/agent-idea-candidate.test.js`

**Interfaces:**
- Consumes: optional `{ discoveryDb, source }` context, where `source` is exact `{ identity, subject, digest }` provenance.
- Produces: `AGENT_IDEA_CANDIDATE_SCHEMA_VERSION`, `AGENT_IDEA_CANDIDATE_SUBJECT`, `AGENT_IDEA_CANDIDATE_CERTIFICATION_BOUNDARY`, `validateAgentIdeaCandidate`, `summarizeAgentIdeaCandidate`, `buildAgentIdeaCandidateReport`, and `formatAgentIdeaCandidateReport`.

- [ ] **Step 1: Write the failing pure-validator tests**

Create literal Candidate and Discovery DB fixtures. Tests must require exact
keys, bounded strings/arrays, sorted unique evidence IDs, fixed boundary,
exact provenance, unique fact resolution, missing/ambiguous ID rejection,
evidence-kind/trust counts, and an `extraction_field` warning. The first import
of `../src/agent-idea-candidate.js` must fail because the module does not exist.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
node --test test/agent-idea-candidate.test.js
```

Expected: FAIL because `src/agent-idea-candidate.js` is absent.

- [ ] **Step 3: Implement the minimal pure module**

Use literal limits and exact-key helpers. Context validation must build a count
map over `discoveryDb.facts[].id`, reject every referenced count other than one,
and compare Candidate provenance to `context.source`. Reporting returns only
bounded IDs/counts/composition/warnings/boundary and never evidence text.

- [ ] **Step 4: Run the focused test and verify GREEN**

```bash
node --test test/agent-idea-candidate.test.js
```

Expected: all Candidate pure tests pass.

- [ ] **Step 5: Refactor only after green**

Remove duplicated shape checks without broadening the API, then rerun the same
command and keep it green.

### Task 2: Durable identity and companion-bound admission

**Files:**
- Modify: `src/artifact-registry.js`
- Modify: `src/artifact-admission.js`
- Modify: `test/artifact-admission.test.js`
- Modify: `test/agent-idea-candidate.test.js`

**Interfaces:**
- Consumes: an authentic `discovery-db` admission as the sole companion.
- Produces: a registered `agent-idea-candidate` descriptor whose validator receives `{ discoveryDb, source }`.

- [ ] **Step 1: Add failing admission tests**

Add real file/admission tests proving exact Candidate bytes require the DB
companion, reject a missing or forged companion, reject a stale source digest,
and accept the exact DB/Candidate pair. Update the existing closed registry
subject/identity expectations without adding an unrelated test case.

- [ ] **Step 2: Verify RED**

```bash
node --test test/agent-idea-candidate.test.js test/artifact-admission.test.js
```

Expected: Candidate admission fails because its durable descriptor/context
branch does not exist.

- [ ] **Step 3: Add the minimal registry and context branch**

Import the Candidate constants/validator. Add one descriptor with
`required_companion_subjects: ["discovery-db"]`. Add only the
`agent-idea-candidate` branch to `buildSourceValidationContext`; do not change
other companion semantics or add Candidate to any downstream subject set.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and require zero new failures.

### Task 3: Public contract, digest ownership, and read-only CLI

**Files:**
- Modify: `src/artifact-contract.js`
- Modify: `src/artifact-subjects.js`
- Modify: `src/cli.js`
- Modify: `test/artifact-contract.test.js`
- Modify: `test/artifact-subjects.test.js`
- Modify: `test/cli.test.js`
- Modify: `test/artifact-surface-coverage.test.js`
- Modify: `test/command-docs.test.js`
- Modify: `test/agent-idea-candidate.test.js`

**Interfaces:**
- Consumes: Candidate path, DB path, exact Candidate digest, exact DB digest.
- Produces: `artifact-contract agent-idea-candidate` and `agent-idea-candidate-report` human/JSON output.

- [ ] **Step 1: Add failing public-surface tests**

Require a validator-valid minimal template, JSON Schema `additionalProperties:
false`, exact boundary constants, CLI help, JSON/human report output, missing /
duplicate / extra / swapped digest rejection, bounded malformed-Candidate
diagnostics, and no output files. Require `CLI_OUTPUT_OWNERS` to classify the
new command as `artifact` and the command subject order to be
`["agent-idea-candidate", "discovery-db"]`.

- [ ] **Step 2: Verify RED**

```bash
node --test test/agent-idea-candidate.test.js test/artifact-contract.test.js test/artifact-subjects.test.js test/cli.test.js test/artifact-surface-coverage.test.js test/command-docs.test.js
```

Expected: failures name the absent contract subject, command, help, and subject
ownership.

- [ ] **Step 3: Implement the public surface**

Add the contract map entry and sorted public subject. Add the durable command
subject. In the CLI, admit DB first and Candidate second with
`companions: { "discovery-db": discoveryDbAdmission }`, build the report using
that exact provenance, emit through `emitArtifactOutput`, and expose bounded
root/subcommand help. Do not accept `--out`, approval, decision, target, or
runtime options.

- [ ] **Step 4: Verify GREEN and preserve baseline evidence**

Run the command from Step 2. Candidate tests must pass. Any pre-existing CLI or
command-doc failures must match the recorded pre-change failures exactly; no new
failure is acceptable.

### Task 4: Shipped distribution closure

**Files:**
- Modify: `package.json`
- Modify: `src/builder-package.js`
- Modify: `scripts/node20-core-receipt.js`
- Modify: `test/node20-core-runner.test.js`
- Modify: `test/artifact-surface-coverage.test.js`

**Interfaces:**
- Consumes: `src/agent-idea-candidate.js` from the checkout.
- Produces: npm, Builder runtime, syntax-check, and Node 20 receipt ownership of the module.

- [ ] **Step 1: Add failing distribution assertions**

Require `src/agent-idea-candidate.js` in `package.json.files`, Builder runtime
inventory, `npm run check` syntax list, and Node 20 syntax ownership. Update the
literal Node 20 syntax count from 40 to 41 in the expected batch.

- [ ] **Step 2: Verify RED**

```bash
node --test test/artifact-surface-coverage.test.js test/node20-core-runner.test.js
```

Expected: missing shipped-module assertions fail.

- [ ] **Step 3: Update all distribution authorities together**

Insert the new module in lexical order in all four inventories and update only
the syntax batch count/fixture that changes because one syntax file was added.

- [ ] **Step 4: Verify GREEN**

Run the command from Step 2 and require all tests to pass.

### Task 5: Stage boundary documentation and regressions

**Files:**
- Modify: `README.md`
- Modify: `docs/STAGE_CONTRACTS.md`
- Modify: `docs/MVP_RUNBOOK.md`
- Create: `release/2026.08.14.md`
- Modify: `release/README.md`
- Modify: `test/stage-contracts.test.js`
- Modify: `test/design-plan.test.js`

**Interfaces:**
- Consumes: the new public Candidate interfaces.
- Produces: maintained Discover boundary and explicit evidence that Stage 2 interfaces remain unchanged.

- [ ] **Step 1: Add failing Stage 2 authority regression**

Add assertions that `design-plan` durable subjects remain exactly discovery
manifest, DB, discovery approval, user need, and decision ledger; Candidate is
not accepted as `--need`, `--discovery-approval`, or an extra digest subject.
Use actual CLI/admission behavior, not source-text grep.

- [ ] **Step 2: Verify RED where new behavior is not yet documented/testable**

```bash
node --test test/design-plan.test.js test/stage-contracts.test.js test/agent-idea-candidate.test.js
```

Expected: newly added Candidate report composition assertions fail until the
public command exists; unchanged Stage 2 authority assertions pass.

- [ ] **Step 3: Update maintained documentation and release evidence**

Document Candidate as an optional proposal-only Discover output and show exact
digest-bound reporting. State that it does not replace user need or discovery
approval and does not authorize Plan. Add the dated release record and newest
release index row. Do not claim automatic Idea generation or human decision
authority.

- [ ] **Step 4: Run the Stage 2 contract set**

```bash
node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js test/agent-idea-candidate.test.js
```

Expected: all tests pass.

### Task 6: Verification, review, and explicit commits

**Files:**
- Review every path listed above.

**Interfaces:**
- Consumes: the completed Candidate slice and repository baseline evidence.
- Produces: verified local commits on `codex/agent-idea-candidate-contract`.

- [ ] **Step 1: Run focused verification**

```bash
node --test test/agent-idea-candidate.test.js test/artifact-contract.test.js test/artifact-admission.test.js test/artifact-subjects.test.js test/artifact-surface-coverage.test.js test/cli.test.js test/command-docs.test.js test/node20-core-runner.test.js
```

Record pass/fail/skip counts and compare any failure to the pre-change baseline
of 93 pass, 4 fail, 1 skip in the same seven-suite command.

- [ ] **Step 2: Run the required Stage 2 regression set**

Use the Task 5 Step 4 command and require complete exit 0.

- [ ] **Step 3: Run repository verification**

```bash
npm run check
git diff --check
```

Do not treat cancellation or incomplete output as passing. If `npm run check`
exposes an unrelated baseline failure, retain exact command, exit code, test
name, and comparison evidence.

- [ ] **Step 4: Self-review requirements and secrets**

Inspect `git diff --check`, `git diff --stat`, and the complete diff. Confirm no
`.env`, raw payload, host-private path, runtime mutation, Plan consumer, or
decision authority entered the change.

- [ ] **Step 5: Stage explicit paths and create decision-record commits**

Use `git add <explicit paths>` only. Commit the reviewed design/plan, core
implementation/tests, and maintained docs/release evidence as coherent local
commits. Include exact verification evidence and known baseline failures in the
commit body. Do not push.

- [ ] **Step 6: Request read-only code review and resolve findings**

Review the full range from `dbb07507e6bd7ef200e33a301e6cbc7618c19dc9` to the
feature HEAD against this plan and the approved design. Fix every Critical and
Important issue with a new failing test first, rerun affected and final gates,
and commit explicit paths.

- [ ] **Step 7: Invoke branch-finishing workflow**

Use `superpowers:finishing-a-development-branch`, retain the branch and local
commits for control-session review, and do not merge, push, or open a PR.

---

## Independent review remediation (2026-08-14)

The control session approved an additive remediation range after independent
review. Existing commits are immutable; every change below is implemented with
a failing regression first and lands only in a new bounded commit.

### Task 7: Central exact-byte JSON safety

**Files:**
- Modify: `src/artifact-registry.js`
- Modify: `src/artifact-admission.js`
- Modify: `test/artifact-admission.test.js`
- Modify: `test/agent-idea-candidate.test.js`

**Interfaces:**
- Produces: a central pre-`JSON.parse` inspection that rejects duplicate member
  names at every object depth and rejects unpaired Unicode surrogates without
  exposing member names or values.

- [x] Add exact-byte admission tests for duplicate Candidate boundary,
  duplicate Candidate free text containing a secret/path canary, duplicate
  nested Discovery DB fact fields, escaped-equivalent member names, and
  `\\ud800` / `\\ud801` surrogate canaries.
- [x] Run `node --test test/artifact-admission.test.js test/agent-idea-candidate.test.js`
  and require the new cases to fail for the reviewed last-wins/replacement-byte
  behavior.
- [x] Generalize the existing bounded scanner so each object tracks all decoded
  member names, string tokens validate surrogate pairing, and admission rejects
  non-JSON/resource/duplicate/surrogate results before `JSON.parse`.
- [x] Rerun the same command and require the complete suites to pass.

### Task 8: Bounded Candidate validation and public diagnostics

**Files:**
- Modify: `src/agent-idea-candidate.js`
- Modify: `src/artifact-contract.js`
- Modify: `src/cli.js`
- Modify: `test/agent-idea-candidate.test.js`
- Modify: `test/artifact-contract.test.js`

**Interfaces:**
- Produces: code-point-aligned string validation, a fixed diagnostic cap,
  no per-item walk after an array exceeds its contract bound, nullable invalid
  report identity, and duplicate single-value option rejection.

- [x] Add a literal boundary matrix covering whitespace, NUL, exact/overflow
  emoji code-point lengths for every Candidate string family, a 20,022-character
  invalid `ideaId`, a 20,000-item invalid array, fixed canary/path/secret text,
  and same/different duplicate `--discovery-db` values.
- [x] Run `node --test test/agent-idea-candidate.test.js test/artifact-contract.test.js`
  and require the new cases to fail for the reviewed mismatches and leaks.
- [x] Add shared Candidate limits/pattern fragments, count Unicode code points,
  stop array item validation after an over-limit error, cap returned diagnostics,
  summarize only a fully valid Candidate, and fail the Candidate CLI parser on
  the second single-value option before path resolution or artifact loading.
- [x] Rerun the same command and require all cases to pass with no partial write
  or canary disclosure.

### Task 9: Stage 2 loader isolation

**Files:**
- Modify: `test/design-plan.test.js`

**Interfaces:**
- Produces: independent real-CLI attempts to substitute Candidate bytes for
  `user-need`, `discovery-approval`, and decision-ledger current-head inputs,
  plus a separate unknown extra-digest regression.

- [x] Supply authentic unaffected companions and exact digest bindings for each
  substitution so execution reaches the selected loader.
- [x] Run `node --test test/design-plan.test.js` and verify each case asserts its
  fixed loader/admission rejection code, exit 1, and absent Plan output.
- [x] Do not change `design-plan` subjects, loader acceptance, or Plan authority.

### Task 10: Node 20 evidence republication

**Files:**
- Create only after producer success: `release/evidence/2026.08.14-node20-core-receipt.json`
- Modify only after producer success: `test/runtime-evidence-consumers.test.js`
- Modify only after producer success: `docs/RUNTIME_COMPATIBILITY.md`
- Modify only after producer success: `release/2026.08.14.md`

**Interfaces:**
- Consumes: the repository-owned distribution trust anchor, canonical Node
  20.20.2 executable, exact official archive, exact checksum manifest, and a
  new absent temporary receipt path.
- Produces: a byte-identical published receipt for the current 41-file manifest;
  historical receipts remain unchanged.

- [x] Confirm the current consumer fails only because the old receipt binds the
  40-file manifest and old command-set digest.
- [x] Locate only already-present trusted inputs; do not download, install,
  activate, search `PATH`, or accept environment overrides.
- [x] Run the repository producer into a newly absent temporary path only when
  all trusted inputs are present. Inputs were unavailable in the repository and
  approved temporary roots, so publish nothing and record the exact bounded
  blocker.
- [ ] After success only, copy the exact receipt bytes to the new release path,
  update post-publication consumer correspondence and maintained evidence text,
  then require `node --test test/runtime-evidence-consumers.test.js` to pass.

### Task 11: Final gates and additive commit

**Files:**
- Modify: `release/2026.08.14.md`
- Review all paths changed by Tasks 7–10.

- [x] Run the adversarial Candidate set, artifact admission/contract/subjects/
  inventory set, selected Stage 1/2 regressions, runtime evidence consumers,
  and `node --check` for every changed production JavaScript file.
- [x] Run `git diff --check dbb0750..HEAD` and `npm run check`; preserve the first
  real full-check failure and final exit/interruption state without retry loops.
- [x] Review the complete diff for bounded/value-blind output, authority
  separation, no `.env`, no host-private paths, and no runtime/Plan expansion.
- [ ] Stage explicit paths only and append one review-remediation commit. Do not
  rewrite, push, merge, open a PR, tag, or create a GitHub Release.
