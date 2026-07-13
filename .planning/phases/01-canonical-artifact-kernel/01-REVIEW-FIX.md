---
phase: 01-canonical-artifact-kernel
fixed_at: 2026-07-11T23:21:13Z
review_path: .planning/phases/01-canonical-artifact-kernel/01-REVIEW.md
iteration: 1
findings_in_scope: 4
fixed: 4
skipped: 0
status: all_fixed
---

# Phase 01: Code Review Fix Report

**Fixed at:** 2026-07-11T23:21:13Z

**Source review:** `.planning/phases/01-canonical-artifact-kernel/01-REVIEW.md`

**Iteration:** 1

**Summary:**

- Findings in scope: 4
- Fixed: 4
- Skipped: 0
- Commits: none; staging and commits were prohibited for this uncommitted Phase worktree

## Fixed Issues

### CR-01: Spelling variants and common credential forms bypass the migration content gate

**Status:** fixed; bounded re-review CLOSED

**Files modified:** `src/evidence-audit.js`, `src/secret-redaction.js`, `test/artifact-migration.test.js`, `test/secret-redaction.test.js`

**Commit:** skipped by project rule

**Applied fix:** Migration keys are normalized by case-folding and removing `_`/`-` before raw-content classification. Credential/private/access-key names and PEM private-key values fail closed; ordinary URL/text controls remain accepted. Preview and apply reject the whole batch without writing output or exposing the value.

**Tests:** focused migration 2/2; secret-redaction 2/2; included in the final 113/113 targeted gate and 292/292 repository gate.

### CR-02: Identity-only inputs are labeled ready and committed as invalid canonical artifacts

**Status:** fixed; bounded re-review CLOSED

**Files modified:** `src/artifact-registry.js`, `src/artifact-migration.js`, `src/blueprint.js`, `src/report.js`, `src/build-state.js`, `test/artifact-migration.test.js`, `test/report.test.js`, `test/build-state.test.js`, `test/fixtures/migration/legacy-blueprint.json`, `test/fixtures/migration/canonical-blueprint.json`, `test/fixtures/migration/legacy-report.json`, `test/fixtures/migration/legacy-build-state.json`

**Commit:** skipped by project rule

**Applied fix:** Every registry record now owns explicit legacy-input and canonical-output validation. Blueprint output reuses `validateBlueprint`; report and build-state use writer-shape validators for maturity/core fields and provenance. Invalid input or transformed output returns value-blind `schema_validation_failed` before output digest or apply. Happy fixtures now contain complete writer-shaped artifacts. Ordinary canonical blueprint loaders retain their established command-specific validation behavior.

**Tests:** CR-02 focused 5/5; artifact-migration + blueprint + report + build-state 83/83; included in the final 113/113 targeted gate and 292/292 repository gate.

### CR-03: Duplicate committed-marker members survive the verifier

**Status:** fixed; bounded re-review CLOSED

**Files modified:** `src/migration-filesystem.js`, `test/artifact-migration.test.js`

**Commit:** skipped by project rule

**Applied fix:** Verification retains the marker bytes, validates the parsed exact fields and plan/path/parent/directory bindings, reconstructs the unique stable serialization, then requires byte-for-byte equality. Duplicate and escaped duplicate members, reordered keys, whitespace changes, and extra newlines fail closed.

**Tests:** marker-focused tamper matrix 20/20; included in the final 113/113 targeted gate and 292/292 repository gate.

### WR-01: `--json` ordinary-loader failures fall back to plain stderr

**Status:** fixed; bounded re-review CLOSED

**Files modified:** `src/cli.js`, `test/cli.test.js`

**Commit:** skipped by project rule

**Applied fix:** A shared CLI command-boundary formatter emits the exact `agentmo.artifact-error.v1` JSON field set `schemaVersion`, `ok`, `code`, `family`, `rule_id`, and `action`. Human output remains bounded, while migrate apply continues using its existing formatter without duplicate output.

**Tests:** legacy build-state status and legacy blueprint validate JSON cases 2/2; included in the final 113/113 targeted gate and 292/292 repository gate.

## Final Verification

| Command | Result |
| --- | --- |
| `node --test test/artifact-migration.test.js test/cli.test.js test/secret-redaction.test.js test/blueprint.test.js test/report.test.js test/build-state.test.js` | PASS — 113/113 |
| `npm run check` | PASS — syntax gates and 292/292 tests across 33 suites |
| `git diff --check` | PASS |

`release/2026.07.11.md` records the remediation, observed counts, hashes, remaining risk, and the unchanged non-certification boundary. No branch, worktree, index, or commit was changed by this fixer. `01-REVIEW.md` remains the original review input; `01-REVIEW-RECHECK.md` records the subsequent clean/GO bounded recheck with all four findings CLOSED.

---

_Fixed: 2026-07-11T23:21:13Z_

_Fixer: generic-agent workaround using gsd-code-fixer role rules_

_Iteration: 1_
