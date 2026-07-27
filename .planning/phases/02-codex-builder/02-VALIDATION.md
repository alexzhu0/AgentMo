---
phase: 02
slug: codex-builder
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-15
---

# Phase 02 — Validation Strategy

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Node.js built-in `node:test` |
| **Config file** | `package.json` |
| **Quick run command** | `node --test <relevant Phase 2 test file>` |
| **Full suite command** | `npm run check` |
| **Estimated runtime** | Existing suite + Phase 2 tests; measure after Wave 1 |

## Sampling Rate

- After every task: run the task's focused `node --test` command.
- After every wave: run `npm run check` and `git diff --check`.
- Phase gate: packed install and fresh-session behavior lanes must pass separately; neither certifies domain quality.
- Max expected focused-test feedback latency: 30 seconds.

## Requirement Verification Map

| Requirement | Test Type | Automated Command | File Status |
|-------------|-----------|-------------------|-------------|
| CORE-05 | contract/negative | `node --test test/builder-adapter-contract.test.js` | ❌ Wave 0 |
| BLDR-01 | packed integration | `node --test test/builder-packed-install.test.js` | ❌ Wave 0 |
| BLDR-02 | unit/integration | `node --test test/codex-builder-probe.test.js` | ❌ Wave 0 |
| BLDR-03 | routing/contract | `node --test test/builder-entry.test.js` | ❌ Wave 0 |
| BLDR-04 | state/hook integration | `node --test test/builder-checkpoint.test.js test/builder-hook.test.js` | ❌ Wave 0 |
| BLDR-05 | read-only negative | `node --test test/builder-doctor.test.js` | ❌ Wave 0 |
| BLDR-06 | lifecycle/hostile FS | `node --test test/builder-lifecycle.test.js` | ❌ Wave 0 |
| BLDR-07 | behavior eval | `node --test test/codex-builder-behavior.test.js` | ❌ Wave 0 |

## Wave 0 Requirements

- Add the eight focused test files above using existing temp-directory, CLI-spawn, digest and value-blind fixtures.
- Add no test framework or third-party dependency.
- Each plan creates its focused tests with the implementation; no test-only horizontal plan.

## Manual/Environment-Bounded Verification

| Behavior | Requirement | Why bounded | Evidence rule |
|----------|-------------|-------------|---------------|
| Hook trust review in a real Codex UI | BLDR-01, BLDR-07 | Trust requires an interactive host decision | Record separately from deterministic fixture tests; never bypass in product flow |
| Fresh desktop session plugin discovery | BLDR-01, BLDR-07 | Desktop restart/plugin cache is host-controlled | Run in isolated test project/CODEX_HOME and record observed version/scope |

## Validation Sign-Off

- [ ] Every plan task has a focused automated command.
- [ ] No three consecutive tasks lack automated feedback.
- [ ] All Wave 0 test files exist and pass.
- [ ] `npm run check` and `git diff --check` pass.
- [ ] Real-host smoke is labeled separately from deterministic tests.
- [ ] Set `nyquist_compliant: true` and `wave_0_complete: true` after all rows are green.

**Approval:** pending execution evidence
