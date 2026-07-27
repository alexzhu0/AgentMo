---
phase: 02-codex-builder
reviewed: 2026-07-22T03:51:03Z
depth: deep
scope: surface
files_reviewed: 33
files_reviewed_list:
  - README.md
  - release/README.md
  - release/2026.07.15.md
  - release/2026.07.16.md
  - release/2026.07.17.md
  - release/2026.07.20.md
  - release/2026.07.21.md
  - package.json
  - src/builder-package.js
  - src/builder-doctor.js
  - src/builder-entry.js
  - src/builder-probe.js
  - src/builders/codex.js
  - src/builders/contract.js
  - src/builders/registry.js
  - src/cli.js
  - src/javascript-static-analysis.js
  - plugin/.codex-plugin/plugin.json
  - plugin/agents/agentmo.toml
  - plugin/hooks/agentmo-hook.js
  - plugin/hooks/hooks.json
  - plugin/skills/agentmo/SKILL.md
  - test/artifact-surface-coverage.test.js
  - test/builder-adapter-contract.test.js
  - test/builder-cli.test.js
  - test/builder-doctor.test.js
  - test/builder-entry.test.js
  - test/builder-package-security.test.js
  - test/builder-packed-install.test.js
  - test/codex-builder-probe.test.js
  - test/helpers/io-surface-inventory.js
  - src/builder-codex-uat-continuation.js
  - src/builder-lifecycle.js
findings:
  critical: 4
  warning: 4
  info: 0
  total: 8
status: issues_found
---

# Phase 02: Surface Code Review Report

**Reviewed:** 2026-07-22T03:51:03Z
**Depth:** deep
**Files Reviewed:** 33
**Status:** issues_found

## Summary

The public lifecycle still implements destructive `uninstall` and host-selector removal, including an internal UAT continuation that performs the removal automatically. That directly conflicts with the v1 requirement to retain physical state and replace uninstall with deactivate plus a tombstone, without any purge path. Package admission also does not prove the complete packed/plugin executable closure, and the UAT relative-reference guard can escape its evidence directory on Windows. Four additional warnings cover an unenforced platform contract, contradictory public UAT instructions, a stale release index, and two abandoned static analyzers.

## Narrative Findings (AI reviewer)

## Critical Issues

### SURF-CR-01: Public `uninstall` still removes the live projection and exposes selector removal

**Classification:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:286`, `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:322`, `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:3433`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1384`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1440`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-lifecycle.js:1586`, `/Users/alexzhu/Lenovo/AgentMo/README.md:57`

**Mechanism:** The parser, dispatcher, help text, README, and exported lifecycle API all retain `builder uninstall`. `prepareUninstall()` emits `delete` operations for receipt-owned files and the receipt, while `applyLifecycle()` retires the live paths, removes the project consumer reference, and returns `projection-removed`. The same public command also offers `--remove-host-selector`. Retaining inode evidence in a private quarantine does not satisfy a deactivate contract: the installed projection and canonical authority are still removed from their live paths, and the public removal route remains callable.

**Impact:** A v1 operator can still approve an irreversible live-path removal instead of producing a retained, inspectable deactivation record. This violates the required no-auto-delete/no-purge lifecycle and makes current CLI/help/release semantics unsafe to ship.

**Fix direction:** Remove the `uninstall`, `--remove-host-selector`, selector-removal, and purge-shaped public/API routes. Introduce an exact-plan `deactivate` transition that leaves all installed bytes and ownership evidence in place, disables use through an append-only tombstone/status record, and can be inspected or reactivated without recovering quarantined paths. Do not retain an undocumented deletion alias.

**Required tests:** Assert that `uninstall`, `purge`, and `--remove-host-selector` are rejected by the parser and absent from help/docs; preview/apply `deactivate`; snapshot all projection and host files before/after; require identical bytes/inodes plus one new exact tombstone; cover idempotent deactivate and explicit reactivate.

### SURF-CR-02: Packed UAT continuation directly executes the forbidden removal

**Classification:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:266`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:304`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-codex-uat-continuation.js:313`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-packed-install.test.js:1435`

**Mechanism:** `continueCodexUatAfterUninstall()` recomputes an uninstall plan and then calls `applyBuilderUninstall()` itself. Success is defined by absence of the project launcher and receipt; the packed test explicitly verifies both paths disappeared and then advances the journal to `candidate-ready`. Therefore deleting the public CLI spelling alone would leave a second, packed destructive path intact.

**Impact:** A continuation command can cross the destructive boundary as part of candidate production, making removal an automated workflow step and encoding the obsolete lifecycle into durable UAT evidence.

**Fix direction:** Replace the `uninstall-visibility` scenario and continuation with `deactivation-tombstone-visibility`. The continuation may verify an externally approved tombstone transition, but it must not call a removal API or require launcher/receipt absence. Keep the installed projection and receipt, append the tombstone, and bind the candidate to those retained exact bytes.

**Required tests:** Prove the continuation has no import/call to uninstall or selector removal; after continuation, assert launcher, receipt, plugin, marketplace, owner, and ledger bytes/inodes remain unchanged; assert one exact tombstone and one deactivation observation are appended; cover interruption/recovery without any missing live path.

### SURF-CR-03: Release admission does not cover the packed/plugin executable closure

**Classification:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/package.json:9`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-package.js:17`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-package.js:373`, `/Users/alexzhu/Lenovo/AgentMo/plugin/hooks/agentmo-hook.js:27`, `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:1147`, `/Users/alexzhu/Lenovo/AgentMo/test/artifact-surface-coverage.test.js:163`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-packed-install.test.js:358`

**Mechanism:** npm publishes the whole `plugin/` and `src/` trees, but `loadBuilderPackage()` reads only a hard-coded asset list and rejects neither extra tarball members nor extra files in the package root. Its closure walk filters to `kind === "runtime"`, so the executable hook is not an entry point even though it uses dynamic imports and spawns the adjacent launcher. The exact I/O inventory likewise scans only `src`, `bin`, and `scripts`; its supposedly exhaustive assertion explicitly accepts only those prefixes. The packed continuation fixture demonstrates that an unlisted JSON member can be shipped and `loadBuilderPackage()` still succeeds.

**Impact:** `releaseDigest` is not a digest of the full shipped executable/data closure. A plugin hook can gain an unlisted dependency or I/O effect without the closure/I/O gates detecting it; activation can then install a broken partial closure, while the tests still claim exact package and effect coverage.

**Fix direction:** Make the npm tarball member set equal an explicit release inventory (with deliberate metadata exceptions), include every runtime data dependency, and walk import/loader closure from all executable entry points including `plugin/hooks/agentmo-hook.js`. Include `plugin/` in I/O surface inventory and classify its filesystem/process effects. Prefer an explicit package `files` allowlist over whole-directory inclusion.

**Required tests:** Pack a tarball and compare every member to the release inventory; reject an extra `src`/plugin/JSON member; add a hook that imports an unlisted helper and require package admission to fail; add a hook write/spawn effect and require the I/O inventory to fail until explicitly classified; verify installed bytes equal the admitted full closure.

### SURF-CR-04: Windows drive paths escape the UAT request-relative evidence boundary

**Classification:** BLOCKER
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1054`, `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1094`, `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1129`, `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:1142`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-cli.test.js:101`

**Mechanism:** `resolveUatEvidenceRef()` rejects a leading `/`, empty segments, and `..`, then calls platform `path.resolve()`. On Windows, `C:\\outside\\evidence.json` and drive-relative `C:evidence.json` pass those checks but `path.resolve(dirname(requestPath), value)` resolves them outside the request directory. The helper is used for baseline/successor packages and tarballs, receipts, host observations, and trust/auth evidence. Tests cover only ordinary POSIX-relative references.

**Impact:** A canonical request advertised as containing relative evidence references can admit files from an unrelated directory on Windows, breaking the evidence-root authority boundary and making the same request semantics platform-dependent.

**Fix direction:** Reject `path.isAbsolute(value)`, `path.win32.isAbsolute(value)`, and any drive-qualified prefix; resolve the candidate and require `path.relative(requestDir, candidate)` to be non-empty/inside and not absolute. Normalize and validate with the target platform rules before any read.

**Required tests:** Reject `C:\\outside\\x`, `C:x`, `\\\\server\\share\\x`, `/outside/x`, mixed separators, and encoded empty/parent segments; accept bounded nested relative paths; run the boundary cases in a Windows CI lane or inject the path implementation into a unit-tested resolver.

## Warnings

### SURF-WR-01: The package advertises generic Node support but core diagnosis is POSIX-only

**Classification:** WARNING
**Files:** `/Users/alexzhu/Lenovo/AgentMo/package.json:20`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-doctor.js:824`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-doctor.js:835`, `/Users/alexzhu/Lenovo/AgentMo/src/builder-doctor.js:838`, `/Users/alexzhu/Lenovo/AgentMo/test/builder-doctor.test.js:601`

**Mechanism:** The package declares only `node >=20` and no OS restriction. Doctor classifies every managed file as `unsafe` when `process.getuid`, `O_NOFOLLOW`, or `O_DIRECTORY` is unavailable; the test suite itself calls `process.getuid()` unguarded. This is the normal Windows condition, not an exceptional unsafe project.

**Impact:** A supported-looking npm install can never obtain a useful doctor report on Windows, and the test suite cannot run there. This also obscures whether the Windows path-boundary bug is meant to be supported or rejected.

**Fix direction:** Either declare and document the exact supported OS set in package metadata and CLI diagnostics, or implement equivalent Windows-safe identity/handle checks and command resolution.

**Required tests:** Add an explicit unsupported-platform contract test or a Windows CI lane that exercises setup, doctor, probe, and packed install without `getuid` assumptions.

### SURF-WR-02: README tells operators to run a UAT protocol that the current CLI rejects

**Classification:** WARNING
**Files:** `/Users/alexzhu/Lenovo/AgentMo/README.md:117`, `/Users/alexzhu/Lenovo/AgentMo/README.md:123`, `/Users/alexzhu/Lenovo/AgentMo/README.md:135`, `/Users/alexzhu/Lenovo/AgentMo/README.md:155`, `/Users/alexzhu/Lenovo/AgentMo/src/cli.js:3442`

**Mechanism:** README correctly says `begin`/`finalize` were superseded, then immediately labels a block a future formal retry and supplies executable `builder codex-uat begin ...` and `finalize ...` commands. The current CLI exposes `start`, `record`, `scenario-arm`, `terminal`, `inspect`, `resume`, and `continue`, so the copied retry procedure fails at argument parsing.

**Impact:** Operators following the primary public runbook cannot start the documented formal UAT and may reach for historical/private workarounds, undermining reproducibility.

**Fix direction:** Remove the obsolete executable block from current README or move it to a clearly historical release record. Publish one current command sequence derived from the parser/help surface.

**Required tests:** Execute every README CLI example in a bounded fixture/dry-run documentation test and assert the action is recognized; fail when README names an action absent from `--help`.

### SURF-WR-03: Release index and recovery anchor omit all reviewed Phase 02 records

**Classification:** WARNING
**Files:** `/Users/alexzhu/Lenovo/AgentMo/release/README.md:29`, `/Users/alexzhu/Lenovo/AgentMo/release/README.md:35`, `/Users/alexzhu/Lenovo/AgentMo/release/README.md:42`

**Mechanism:** The index says records are reverse chronological but stops at 2026.07.13, while 2026.07.15, .16, .17, .20, and .21 exist and contain the current Builder lifecycle and evidence decisions. The recovery anchor still describes Phase 01.2 as the current focus.

**Impact:** Session recovery starts from stale architecture and lifecycle guidance, increasing the risk that recent safety/evidence decisions are missed or contradicted.

**Fix direction:** Add all Phase 02 records in descending order and update the recovery anchor/status to the current phase and evidence boundary.

**Required tests:** Add a documentation check that every `release/YYYY.MM.DD.md` file appears exactly once in the index in descending date order.

### SURF-WR-04: Two obsolete static analyzers remain beside the canonical implementation

**Classification:** WARNING
**Files:** `/Users/alexzhu/Lenovo/AgentMo/src/builder-package.js:434`, `/Users/alexzhu/Lenovo/AgentMo/test/helpers/io-surface-inventory.js:1173`

**Mechanism:** `builder-package.js` retains a complete `extractEsmSpecifiers` tokenizer/parser that has no caller after closure validation switched to `analyzeJavaScriptSource()`. The I/O helper likewise retains `inventoryJavaScriptSourceLegacy()` and its private regex helpers while the exported function delegates to the canonical analyzer. Repository search finds no call to either legacy entry point.

**Impact:** Security-sensitive loader and I/O logic now has two abandoned implementations that can be patched or reviewed by mistake, increasing drift and audit cost.

**Fix direction:** Delete both legacy analyzers and any helpers used only by them; keep one canonical analyzer and its focused regression fixtures.

**Required tests:** Run the package-security and artifact-surface suites after deletion and add a lint/dead-code check for unreferenced module-scope functions in these security-sensitive files.

---

_Reviewed: 2026-07-22T03:51:03Z_
_Reviewer: the agent (gsd-code-reviewer, surface partition)_
_Depth: deep_
