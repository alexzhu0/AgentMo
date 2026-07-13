# Testing Patterns

**Analysis Date:** 2026-07-10

## Test Framework

**Runner:**
- Node.js built-in `node:test`.
- No separate test configuration file; discovery is the default `node --test` behavior.

**Assertion Library:**
- `node:assert/strict`, normally imported as `assert`.
- Common assertions: `equal`, `deepEqual`, `match`, `ok`, `rejects`, `throws`, and `doesNotMatch`.

**Run Commands:**
```bash
npm run check
node --test
node --test test/design-plan.test.js
node --test test/stage-contracts.test.js
bash -n scripts/openclaw-live-smoke.sh
```

`npm run check` is the repository-wide gate: explicit `node --check` calls for production modules followed by the complete Node test suite.

## Test File Organization

**Location:**
- All tests live under the flat `test/` directory.
- Tests import production modules from `../src/*.js` or spawn `../bin/agentmo.js`.

**Naming:**
- Focused tests mirror production modules as `<module>.test.js`.
- Cross-cutting suites use behavior names such as `stage-contracts.test.js`, `cli-mvp.test.js`, and `runtime-replay-eval.test.js`.

**Representative structure:**
```text
src/design-plan.js                 -> test/design-plan.test.js
src/discovery-source-workspace.js  -> test/discovery-source-workspace.test.js
src/runtime-execution.js           -> test/runtime-execution.test.js
src/targets/*.js                   -> test/targets.test.js
bin/agentmo.js + src/cli.js        -> test/cli.test.js, test/cli-mvp.test.js
```

## Test Structure

**Suite organization:**
```javascript
import assert from "node:assert/strict";
import { describe, it } from "node:test";

describe("artifact or mechanism", () => {
  it("accepts the valid contract", async () => {
    const result = await buildOrLoadFixture();
    assert.equal(result.ok, true);
  });

  it("fails closed on unsafe evidence", async () => {
    await assert.rejects(() => operation(), /expected boundary/u);
  });
});
```

**Patterns:**
- Arrange data inline or load a bounded example fixture.
- Exercise the public builder/validator or the real CLI entry point.
- Assert explicit schema fields, checks, warnings, artifact lists, and non-certification flags.
- Pair happy-path behavior with negative safety/provenance/evidence cases.

## Mocking and Dependency Control

**Framework:**
- No mocking library is installed.

**Patterns:**
- Inject a `commandRunner` callback into runtime/run-state functions to simulate live execution deterministically.
- Spawn `process.execPath` with argument arrays for CLI tests; avoid shell-string construction.
- Use temporary executable scripts only where process-tree timeout behavior must be tested.
- Temporarily manipulate selected environment variables only inside scoped tests and restore them afterward.

**What is simulated:**
- External OpenClaw/provider execution.
- Success, failure, timeout, fallback, replay, and unsafe evidence conditions.
- Corrupt or mismatched artifacts.

**What is exercised for real:**
- JSON parsing/validation and deterministic builders.
- Filesystem reads/writes in isolated temp directories.
- CLI subprocess exit codes and stdout/stderr boundaries.
- POSIX process-group termination on supported platforms.

## Fixtures and Factories

**Repository fixtures:**
- `examples/win9.agentmo.json` and `examples/win9.discovery.json` provide the broad reference blueprint.
- `examples/support-triage.*` provides the composed MVP discovery/need/blueprint/domain-case slice.
- `examples/fixtures/support-triage/` provides sanitized source documents and a prebuilt discovery DB.

**In-test data:**
- Tests use object spread to derive invalid or variant artifacts from a known-valid fixture.
- Helper functions such as CLI spawners and recursive file listers are defined near the suite that uses them.
- `mkdtemp(path.join(tmpdir(), "agentmo-..."))` isolates file-producing tests.

## Coverage

**Requirements:**
- No numeric line/branch coverage target is configured.
- Coverage quality is enforced behaviorally through contract, fail-closed, CLI, and vertical-slice tests.

**Configuration:**
- No coverage provider, report script, or CI threshold exists in `package.json`.
- Important untested surfaces must be disclosed in release records and PR descriptions.

## Test Types

**Unit/contract tests:**
- Validate individual artifact builders and validators.
- Examples: `test/user-need.test.js`, `test/blueprint.test.js`, `test/domain-eval.test.js`.

**Filesystem integration tests:**
- Materialize discovery, handoff, scaffold, build state, run state, and observation artifacts in temp directories.
- Assert deterministic paths and refuse unsafe/non-empty targets.

**CLI integration tests:**
- Spawn `bin/agentmo.js` and inspect status, JSON, error redaction, and written artifacts.
- `test/stage-contracts.test.js` proves each stage can operate from its input contract independently.

**Process/runtime tests:**
- Verify constrained environment passing, bounded output capture, timeout exit code `124`, descendant cleanup, replay identity, and raw-evidence rejection.
- Windows skips POSIX-only process-group tests.

**End-to-end/vertical slice:**
- `test/cli-mvp.test.js` and the support-triage runbook compose the MVP artifact chain.
- Default tests use declared or simulated runtime evidence; real provider execution remains an optional live smoke.

## Common Patterns

**Async filesystem test:**
```javascript
const out = await mkdtemp(path.join(tmpdir(), "agentmo-example-"));
const result = await writeArtifact(out, artifact);
const stored = JSON.parse(await readFile(result.path, "utf8"));
assert.equal(stored.schemaVersion, EXPECTED_SCHEMA);
```

**Fail-closed test:**
```javascript
await assert.rejects(
  () => buildFromUnsafeInput(unsafeInput),
  /unsafe|invalid|mismatch/u,
);
```

**CLI test:**
```javascript
const child = spawn(process.execPath, [CLI, ...args], {
  stdio: ["ignore", "pipe", "pipe"],
});
```

**Snapshot testing:**
- Not used. The project favors explicit fields, exact arrays, and stable hashes/paths over opaque snapshots.

---

*Testing analysis: 2026-07-10*
*Update when verification commands or test infrastructure changes*
