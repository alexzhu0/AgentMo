---
phase: 01-canonical-artifact-kernel
reviewed: 2026-07-11T22:05:11Z
depth: standard
files_reviewed: 33
files_reviewed_list:
  - package.json
  - examples/support-triage.agentmo.json
  - examples/win9.agentmo.json
  - src/artifact-migration.js
  - src/artifact-registry.js
  - src/migration-filesystem.js
  - src/birth-report.js
  - src/blueprint-draft.js
  - src/blueprint.js
  - src/build-state.js
  - src/cli.js
  - src/control-snapshot.js
  - src/evidence-audit.js
  - src/handoff.js
  - src/report.js
  - src/scaffold-files.js
  - src/secret-redaction.js
  - test/artifact-migration.test.js
  - test/canonical-identity.test.js
  - test/cli.test.js
  - test/blueprint-draft.test.js
  - test/build-state.test.js
  - test/control-snapshot.test.js
  - test/report.test.js
  - test/scaffold.test.js
  - test/stage-contracts.test.js
  - test/targets.test.js
  - test/helpers/migration-parent-swap-child.js
  - test/fixtures/migration/canonical-blueprint.json
  - test/fixtures/migration/hostile-secret.json
  - test/fixtures/migration/legacy-blueprint.json
  - test/fixtures/migration/legacy-build-state.json
  - test/fixtures/migration/legacy-report.json
findings:
  critical: 3
  warning: 1
  info: 0
  total: 4
status: issues_found
---

# Phase 01: Code Review Report

**Reviewed:** 2026-07-11T22:05:11Z
**Depth:** standard
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The canonical AgentMo writers and active examples consistently use `agentmo_*` identity and the exact Discover, Plan, Produce pipeline. The migration filesystem also contains substantial fail-closed path, handle, mode, file-set, receipt, digest, orphan, and decommit checks. However, three ship-blocking gaps remain: forbidden content can bypass the value-blind audit and be copied into canonical output, identity-only objects can be committed as successfully migrated artifacts without schema validation, and an ambiguous duplicate-member committed marker can still pass verification. The ordinary-loader error is structured in-process, but its CLI `--json` path is not machine-readable.

## Narrative Findings (AI reviewer)

## Critical Issues

### CR-01 [Critical]: Spelling variants and common credential forms bypass the migration content gate

**Files:** `src/evidence-audit.js:156-158`, `src/evidence-audit.js:176-212`, `src/secret-redaction.js:4-6`, `src/secret-redaction.js:27-47`

**Issue:** `auditMigrationCandidate` recognizes raw-content fields through exact, case-sensitive names and recognizes secret values only through the limited substitutions in `redactSecrets`. Consequently, keys such as `raw_transcript`, `tool_output`, `Transcript`, `credential`, `privateKey`, and `accessKey` are not rejected, and PEM-shaped private-key material is not recognized by value. This is not merely a diagnostic miss: `inspectArtifactForMigration` returns `migration_required`, `planArtifactMigration` marks the item `ready`, and the transform copies the unrecognized field and value into the canonical payload. An in-memory plan built from an otherwise valid legacy blueprint plus a dummy `privateKey` or non-empty `raw_transcript` reproduced `applicable: true` and `result: "ready"`.

**Fix:** Normalize candidate keys before classification (case-fold and remove `_`/`-` separators), cover credential/private-key/access-key and PEM/key-block forms, and explicitly admit only the project's bounded SecretRef representation rather than treating all unrecognized fields as safe. Add positive controls plus negative tests for snake_case, kebab-case, capitalization variants, credential fields, private-key blocks, and raw transcript/tool-output variants; assert both preview and apply reject the whole batch without emitting the value.

### CR-02 [Critical]: Identity-only inputs are labeled ready and committed as invalid canonical artifacts

**Files:** `src/artifact-registry.js:273-327`, `src/artifact-registry.js:373-401`, `src/artifact-migration.js:187-205`

**Issue:** Family admission validates only marker ownership and version tuples. It never validates the legacy artifact's required structure or the transformed artifact against the canonical family contract. For example, `{ "agentmother_version": "0.1" }` is classified as a supported blueprint, produces a `ready`/applicable plan, and transforms to `{ "agentmo_version": "0.1" }`; `validateBlueprint` rejects that output with missing required fields. The shipped migration fixtures reinforce this blind spot by using identity-only blueprint/report/build-state shapes rather than complete durable artifacts. Apply can therefore publish and verify byte/digest-consistent files that are unusable as the canonical artifact they claim to be.

**Fix:** Give every registry record explicit legacy-input and canonical-output validators. Reject before planning unless the complete legacy shape is supported, then validate the transformed value again before computing `output_digest`; use a stable value-blind reason such as `schema_validation_failed`. Replace identity-only happy-path fixtures with complete real family artifacts and add negative cases proving a version marker alone, missing report maturity fields, and incomplete build-state provenance never become `ready` or verifiable output.

### CR-03 [Critical]: Duplicate committed-marker members survive the verifier

**Files:** `src/migration-filesystem.js:786-800`, `src/migration-filesystem.js:842-870`

**Issue:** The verifier parses the marker with ordinary `JSON.parse` and applies the exact-field check only to the resulting object. Duplicate JSON members have already collapsed at that point. Rewriting a valid marker so it contains a conflicting duplicate `state`, `plan_digest`, `parent_identity`, or `directory_identity` followed by the original valid member leaves the parsed object and `Object.keys` set unchanged, so `validateCommittedMarker` accepts it. Receipt bytes are compared canonically, but marker bytes receive neither a canonical-byte comparison nor a duplicate-member scan. A tampered, ambiguous ownership/commit marker can therefore still yield `{ ok: true }`, contrary to the verifier's fail-closed marker binding.

**Fix:** Retain the raw marker bytes, reject duplicate members before `JSON.parse`, and compare the bytes with the one canonical stable serialization reconstructed from the validated marker (including its instance token). Add raw-byte tests for duplicate first/last `state`, plan/path/identity fields, escaped duplicate keys, and marker reformatting; all must fail verification.

## Warnings

### WR-01 [Warning]: `--json` ordinary-loader failures fall back to plain stderr

**Files:** `src/cli.js:67-70`, `src/cli.js:178-184`, `src/cli.js:710-717`, `test/cli.test.js:150-161`

**Issue:** Loader errors correctly preserve `AGENTMO_MIGRATION_REQUIRED`, but only the `migrate --out` branch has JSON/human error formatters. `status ... --build-state <legacy> --json` rethrows before the snapshot formatter, and `validate <legacy> --json` discards the parsed JSON flag. The process exits closed, but emits a human sentence on stderr instead of a stable JSON envelope. The CLI test passes `--json` and explicitly asserts that plain stderr, so it codifies rather than detects the machine-interface break.

**Fix:** Route structured artifact-admission errors through a shared command-boundary formatter. When `--json` was requested, emit a versioned value-blind object containing at least `ok`, `code`, `family`, `rule_id`, and the migration action; use the existing bounded human message otherwise. Update the status and validate tests to parse JSON and assert the exact stable field set while continuing to forbid source paths and basenames.

---

_Reviewed: 2026-07-11T22:05:11Z_
_Reviewer: generic-agent workaround (gsd-code-reviewer role rules)_
_Depth: standard_
