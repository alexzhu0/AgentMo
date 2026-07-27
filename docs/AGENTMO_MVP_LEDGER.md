# AgentMo MVP Ledger

## 2026-07-06 — MVP birth-loop implementation

Scope:

- Added sanitized discovery pack materialization.
- Added concrete user-need validation/reporting.
- Added deterministic blueprint draft generation from discovery DB plus need brief.
- Added coding/runtime handoff package generation.
- Added fail-closed birth report over blueprint/build/run/eval evidence.
- Added support-triage fixture and declared vertical-slice test.

Evidence level:

- Current MVP slice is `declared` evidence by default.
- `live-success` remains required before runtime promotion.
- No production, runtime parity, or domain certification is claimed from this MVP ledger entry.

Verification commands:

```bash
node --test test/discovery-db.test.js test/user-need.test.js test/blueprint-draft.test.js test/handoff.test.js test/birth-report.test.js test/cli-mvp.test.js
npm run check
git diff --check
```

Observed local evidence:

- Declared support-triage MVP runbook output: `/tmp/agentmo-support-triage-mvp/`
- Birth report: `/tmp/agentmo-support-triage-mvp/birth-report.json`
- Birth report result: `ok=true`, `birthStatus=declared-ready`, `evidenceLevel=declared`
- Certification boundary: runtime/domain certification remain `false`
- Independent review: superseded by the final Ultragoal review gate; do not treat this entry as merge/release approval without the final quality-gate record.

Known risks:

- The OMX tmux team runtime could not launch because the existing working tree was dirty and team workers require dedicated worktrees; implementation used leader-owned integration plus a native read-only explorer fallback.
- Declared birth evidence proves wiring only. Live OpenClaw execution must be run separately with isolated state before runtime promotion.
- Generated blueprint drafts are valid starting points and still require human/domain review before production use.

## 2026-07-07 — Support-triage live-success promotion

Scope:

- Ran support-triage through isolated OpenClaw live smoke with DeepSeek flash.
- Fixed AgentMo run-state evidence so unstructured live stdout/stderr is persisted only as digest/length metadata, not raw previews.
- Re-ran `birth-report --expect-status success` over the live run-state/eval/build-state artifacts.

Evidence level:

- Runtime evidence reached `live-success`.
- Birth status reached `born`.
- `promotionEligible=true`.
- Runtime/domain certification remain explicitly `false`.

Observed local evidence:

- Evidence directory: `/tmp/agentmo-openclaw-runs-20260707T153450-support-triage-live.eooycf`
- Birth report: `/tmp/agentmo-openclaw-runs-20260707T153450-support-triage-live.eooycf/agentmo-birth-report-success.json`
- Birth report hash: `6e169c9caec8b41edc955ebbb5d4de07489a05e28dfd92b8632f5d42cf8b2720`

Known risks:

- Live-success proves isolated runtime execution only.
- Domain certification still requires separate eval/rubric evidence.
- Evidence paths are local `/tmp` artifacts and should not be treated as long-term repository evidence.

## 2026-07-07 — Stage 3 delivery closure documentation

Scope:

- Restored minimal docs for the three AgentMo stages: data discovery database, user-need planning, and Agent design/implementation/delivery.
- Documented `domain-eval` as independent bounded domain-quality evidence.
- Documented `delivery-report` as aggregation/revalidation over source artifacts, not a self-certifying report.

Evidence semantics:

- `birth-report` remains mechanism/runtime birth evidence only and does not prove domain quality or production approval.
- The support-triage deterministic fixture is sanitized and bounded; it proves sample mechanism/case coverage only.
- No OpenClaw production or domain certification is claimed by this ledger entry.

Verification for this docs/scaffold pass:

```bash
node --check src/scaffold-files.js src/handoff.js
git diff --check
```
## 2026-07-10 — Stage 2 design-plan contract

Scope:

- Added `agentmo.design-plan.v1` as a first-class Stage 2 artifact between discovery DB/user need and blueprint drafting.
- Added `agentmo design-plan` CLI and required-but-compatible `blueprint-draft --design-plan` integration.
- Centralized bounded `source_refs` validation across user need, design-plan, and blueprint drafting.
- Preserved Stage 3 decoupling: blueprint handoff still starts from a valid design contract, not Stage 1 command ancestry.

Evidence semantics:

- `design-plan` records requirements trace, evidence refs, gaps, eval plan, governance gates, and certification boundary.
- Missing or partial evidence is allowed only when explicit and governed; it does not become a production claim.
- Design planning still does not certify runtime execution, domain-wide quality, or production approval.

Verification commands:

```bash
node --test test/design-plan.test.js
node --test test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
npm run check
git diff --check
```

Known risks:

- Initial evidence matching is deterministic and lexical; future semantic retrieval can improve coverage without changing the artifact boundary.
- GitHub release publication is not implied by this ledger entry until the commit/tag/release step is performed separately.

## 2026-07-12 — Phase 01.1 artifact safety closure

Scope:

- Closed maintained README/docs command examples against the production durable-subject registry and exact file-byte digest contract.
- Corrected documented runtime execution to `run-plan <blueprint> -> runtime-plan -> run <runtime-plan>` while keeping Stage 2 `design-plan` distinct from scaffold dry-run `plan`.
- Closed the exact loader/read/write/lifecycle/serializer/output/shell inventory with zero pending and zero unclassified rows.
- Documented closed evidence carriers, retained-handle legacy migration recovery, zero-write preflight failures, raw runtime-material exclusion, and non-transitive certification.

Observed verification:

- Focused command/registry/inventory gate: 14/14 tests passed.
- Repository gate: 383/383 tests passed across 41 suites.
- Whitespace gate passed.

Evidence boundary:

- These results prove deterministic admission, persistence, command, and documentation closure in the local test harness.
- No provider call, live OpenClaw smoke, external runtime certification, domain-wide quality approval, or production approval was performed or inferred.

## 2026-07-23 — Phase 02 local release-gate closure

Scope:

- Closed a concrete UAT append-capability disclosure through a hostile same-realm `Object.freeze` wrapper.
- Kept the UAT token lexical and removed it from generic immutable-journal normalization before any caller-observable frozen record is made.
- Added a packed fresh-child regression that recursively audits every frozen object captured by the hook and verifies that no captured value can append raw UAT genesis or successor bytes.
- Reconciled the exact I/O surface inventory after the authority-transport change.

Observed verification:

- `node --test test/builder-codex-uat.test.js`: 27/27 passed.
- `node --test test/builder-immutable-journal-v1.test.js`: 4/4 passed.
- `node --test test/artifact-surface-coverage.test.js`: 17/17 passed.
- `npm run check`: 760 pass, 0 fail, 1 skip.
- `git diff --check`: passed.
- Fresh final release review: Critical 0, Warning 0 in `.planning/phases/02-codex-builder/02-FINAL-RELEASE-REVIEW.md`.

Evidence boundary:

- This closes the local mechanism gate only. It does not prove a real Codex session, OpenClaw execution, external human approval, domain quality, production readiness, deployment approval, or wider compatibility.
- The hostile-hook regression assumes the wrapper calls the original `Object.freeze`; arbitrary same-realm primordial replacement, debugger access, source modification, and cryptographic module origin are outside this bounded claim.
- No `.env` content was read and no live UAT, commit, push, tag, package publication, or GitHub Release occurred.

## 2026-07-22 — Builder v1 append-only review-fix iteration

Scope:

- Replaced physical Builder lifecycle removal with append-only deactivation tombstones and reactivation successors.
- Kept the hidden `uninstall` spelling only as a deprecated non-delete alias for `deactivate`; purge, selector removal, host projection replacement, and canonical receipt replacement fail closed.
- Moved upgrades to immutable version-qualified release paths and kept earlier receipts, releases, projected bytes, and evidence immutable and inert.
- Migrated the Codex UAT public surface to immutable-journal `start`, exact-head `record`, `scenario-arm`, `terminal`, `inspect`, `resume`, and packed `continue` operations.
- Bound behavior admission to the exact journal head and immutable candidate leaf. Verifier `decide` results remain caller-reported and nonterminal because no independent external human decision authority is implemented.

Focused evidence observed during the ongoing review-fix iteration:

```bash
node --test test/builder-append-only-authority.test.js
node --test test/builder-lifecycle-v1.test.js
node --test test/builder-install-security.test.js
node --test test/builder-immutable-journal-v1.test.js
node --test test/codex-builder-behavior.test.js
```

The focused lanes above have passed at their recorded checkpoints. The aggregate repository gate, package closure, and final independent review are still pending for this iteration; this entry must not be read as a final all-green claim.

Migration boundary:

- A projected-v2 canonical receipt is immutable genesis and cannot be overwritten by an activated-v4 setup receipt. Use an immutable version-qualified lifecycle successor; choose user-host activation during initial setup for a new absent installation.
- Existing release bytes, receipt bytes, lifecycle evidence, host evidence, and UAT evidence are retained. Deactivation changes authority by appending a tombstone, not by deleting or renaming prior state.

Evidence boundary:

- Passing focused mechanism tests do not prove a real Codex session, eleven-scenario UAT completion, human approval, Agent Package quality, domain quality, production readiness, deployment approval, or wider compatibility.
- `preview` and caller-reported `decide approve|reject` do not establish human decision authority.
- No real UAT, network publication, tag, package publication, deployment, or `.env` access was performed for this ledger entry.
