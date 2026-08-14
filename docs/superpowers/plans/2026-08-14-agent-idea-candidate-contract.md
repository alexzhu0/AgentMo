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
