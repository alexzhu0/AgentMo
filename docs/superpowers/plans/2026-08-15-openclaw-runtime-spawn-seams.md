# OpenClaw Runtime Spawn Seams Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Classify all three POC child-process sites and make both real OpenClaw spawn paths fail before preparation or effects on an unsupported current runtime, restoring the trusted Node.js 20 producer without changing product capability.

**Architecture:** Both effectful POC entry points call the existing zero-argument `assertCurrentOpenClawTargetRuntime` as their first statement, and each private real OpenClaw spawn helper repeats that guard immediately before `spawn`. The browser opener remains a separately classified local UI effect protected only by strict authenticated-loopback URL validation. Tests own an explicit site/classification/owner inventory and prove incompatible-runtime and invalid-browser zero-effect behavior.

**Tech Stack:** Node.js 20+ ESM, built-in `node:test`, `node:child_process`, AgentMo repository-owned runtime compatibility policy, trusted Node.js 20 receipt producer and exact post-publication evidence consumer.

## Global Constraints

- Use `superpowers:test-driven-development` during implementation and keep RED, GREEN, and REFACTOR evidence distinct.
- Reuse `assertCurrentOpenClawTargetRuntime()` exactly; do not add caller, option, callback, or environment override.
- Preserve `scripts/node20-distribution-trust.json` byte-for-byte and keep the five-file core command-manifest membership unchanged. Expected counts and digest must match the frozen official Node.js 20 measurement, never a forecast.
- Do not read `.env`, run OpenClaw, install runtime globally, modify `PATH`, activate plugins, schedule, deliver, or contact a provider.
- The browser opener is `local-ui-child`, not evidence of OpenClaw runtime compatibility.
- Runtime rejection must use `AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED` and remain bounded and value-blind.
- Historical `release/evidence/2026.07.13-node20-core-receipt.json` is immutable.
- A new receipt may be published only from exact bytes produced at exit 0 into a previously absent temporary path.
- Do not commit, push, merge, open a PR, tag, or publish a GitHub Release without a new explicit authorization.

---

### Task 1: RED — specify three sites and incompatible-runtime zero effects

**Files:**
- Modify: `test/runtime-compatibility-seams.test.js`
- Modify: `test/poc-openclaw-runtime.test.js`

**Interfaces:**
- Consumes: `runPocOpenClaw(options)`, `runPocOpenClawDashboard(options)`, `openPocDashboardUrl(url, options)`, and the existing `withSimulatedCurrentNodeVersion` / `assertUnsupportedCurrentRuntime` helpers.
- Produces: an explicit test-owned POC child-site inventory and failing behavioral contracts for the two unguarded OpenClaw flows.

- [ ] **Step 1: Add exact imports and isolated POC fixture support**

In `test/runtime-compatibility-seams.test.js`, extend imports without reading any
secret file:

```js
import { mkdtemp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { writePocWorkspace } from "../src/poc-agent.js";
import {
  runPocOpenClaw,
  runPocOpenClawDashboard,
} from "../src/poc-openclaw-runtime.js";
```

Add a local `pocRuntimeSeed()` returning one bounded synthetic record with the
existing `agentmo.poc-seed.v1` shape. Tests write only a synthetic
`DEEPSEEK_API_KEY=test-only-provider-secret` file under their fresh test temp
directory; they never read `.env`.

- [ ] **Step 2: Replace the bare POC spawn count with an explicit site inventory**

Add this frozen test authority near `JAVASCRIPT_MUTATION_INVENTORY`:

```js
const POC_CHILD_PROCESS_SITE_INVENTORY = Object.freeze([
  Object.freeze({
    id: "poc-dashboard-browser-child",
    kind: "local-ui-child",
    implementation: "openPocDashboardUrl",
    owners: Object.freeze(["openPocDashboardUrl"]),
  }),
  Object.freeze({
    id: "poc-openclaw-command-child",
    kind: "openclaw-runtime-child",
    implementation: "executePocOpenClawCommand",
    owners: Object.freeze(["runPocOpenClaw", "runPocOpenClawDashboard"]),
  }),
  Object.freeze({
    id: "poc-openclaw-gateway-child",
    kind: "openclaw-runtime-child",
    implementation: "executePocGateway",
    owners: Object.freeze(["runPocOpenClawDashboard"]),
  }),
]);
```

Rename the existing inventory test to exactly:

```text
classifies every production spawn and binds OpenClaw children to guarded owners
```

Make it assert the three exact entries, one source-level child call per entry,
the overall `src/poc-openclaw-runtime.js` count of 3, and no unclassified POC
spawn. Add ordered source assertions requiring both public owners to place
`assertCurrentOpenClawTargetRuntime();` before `path.resolve`,
`checkPocWorkspace`, `readRuntimeEnvFile`, `mkdir`, token creation,
`runCommand`, or `runGateway`. Require both private OpenClaw helpers to place
the guard before `spawn`, and assert that the browser slice contains no
`assertCurrentOpenClawTargetRuntime` token.

Use the repository tokenizer/module-binding/call parser through the dedicated
`inventoryChildProcessCallSites` entry point. This inventory is
static-import-only for child-process authority: allow only direct named or
namespace calls from static `child_process`/`node:child_process` imports.
Reject binding re-alias/escape, computed members, dynamic or constructed
child-process imports, every code-level `require`, `getBuiltinModule`, or
`createRequire` identifier/member reference, and every `module`/`node:module`
import, export, or re-export. A local identifier collision is intentionally
rejected. Reject all `process`/`node:process` static imports. Permit the global
`process` authority only as the base of a direct static dot-property read or
call; reject computed properties, assignment/value escape, argument passing,
return, `Reflect.get`, and `.bind` acquisition. Cover bracket string, escaped
string, and static template property spellings without rejecting loader-shaped
comments, strings, non-expression templates, or regex decoys. Do not change
general `analyzeJavaScriptSource` admission.

- [ ] **Step 3: Add hostile-options entry tests**

Add a helper that fails visibly on every relevant Proxy interaction while
keeping the canary out of normal test output:

```js
function hostilePocOptions() {
  const trapCounts = {
    get: 0,
    has: 0,
    ownKeys: 0,
    getOwnPropertyDescriptor: 0,
  };
  const fail = (trap) => {
    trapCounts[trap] += 1;
    throw new Error("options-canary /private/options-canary sk-options-canary123456");
  };
  const options = new Proxy(Object.create(null), {
    get: () => fail("get"),
    has: () => fail("has"),
    ownKeys: () => fail("ownKeys"),
    getOwnPropertyDescriptor: () => fail("getOwnPropertyDescriptor"),
  });
  return Object.freeze({ options, trapCounts });
}
```

Add these exact tests:

```text
rejects POC OpenClaw command entry before reading any hostile options property
rejects POC OpenClaw Dashboard entry before reading any hostile options property
```

Capture the rejection without formatting or inspecting the Proxy:

```js
async function captureRejectedError(operation) {
  let caught;
  try {
    await operation();
  } catch (error) {
    caught = error;
  }
  assert.notEqual(caught, undefined, "operation must reject");
  return caught;
}
```

For each public function, simulate `INCOMPATIBLE_CONTRACT_VERSION`, pass the
hostile Proxy as the sole options argument, and capture the rejection. Then
assert:

```js
const { options, trapCounts } = hostilePocOptions();
const error = await withSimulatedCurrentNodeVersion(
  INCOMPATIBLE_CONTRACT_VERSION,
  () => captureRejectedError(() => runPocOpenClaw(options)),
);
assert.deepEqual(trapCounts, {
  get: 0,
  has: 0,
  ownKeys: 0,
  getOwnPropertyDescriptor: 0,
});
assert.equal(error.code, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED");
assert.equal(error.message, "Current process does not satisfy the OpenClaw target runtime range.");
const rendered = `${error.name}:${error.message}:${error.code}:${JSON.stringify(error)}`;
assert.equal(rendered.includes("options-canary"), false);
assert.equal(rendered.includes("/private/options-canary"), false);
assert.equal(rendered.includes("sk-options-canary"), false);
```

The Dashboard test uses a fresh Proxy and trap-count object:

```js
const dashboardHostile = hostilePocOptions();
const dashboardError = await withSimulatedCurrentNodeVersion(
  INCOMPATIBLE_CONTRACT_VERSION,
  () => captureRejectedError(() => runPocOpenClawDashboard(dashboardHostile.options)),
);
assert.deepEqual(dashboardHostile.trapCounts, {
  get: 0,
  has: 0,
  ownKeys: 0,
  getOwnPropertyDescriptor: 0,
});
assert.equal(dashboardError.code, "AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED");
assert.equal(dashboardError.message, "Current process does not satisfy the OpenClaw target runtime range.");
const dashboardRendered = `${dashboardError.name}:${dashboardError.message}:${dashboardError.code}:${JSON.stringify(dashboardError)}`;
assert.equal(dashboardRendered.includes("options-canary"), false);
assert.equal(dashboardRendered.includes("/private/options-canary"), false);
assert.equal(dashboardRendered.includes("sk-options-canary"), false);
```

Do not weaken `assertUnsupportedCurrentRuntime` and do not access the Proxy
from assertion labels or diagnostic formatting. Against the current
implementation, the first `options.workspace` read triggers the `get` trap, so
these tests are genuine RED evidence.

- [ ] **Step 4: Add the ordinary-command zero-effect test**

Add a test named exactly:

```text
rejects POC OpenClaw commands before workspace, runtime-env, profile, credential, or runner effects
```

The core test body is:

```js
const root = await mkdtemp(path.join(tmpdir(), "agentmo-poc-command-runtime-seam-"));
const workspace = path.join(root, "workspace");
const envFile = path.join(root, "runtime.env");
const profileHome = path.join(workspace, ".agentmo-poc-home");
await writePocWorkspace(pocRuntimeSeed(), workspace);
await writeFile(envFile, "DEEPSEEK_API_KEY=test-only-provider-secret\n", "utf8");
const effects = [];

await withSimulatedCurrentNodeVersion(INCOMPATIBLE_CONTRACT_VERSION, async () => {
  await assertUnsupportedCurrentRuntime(() => runPocOpenClaw({
    workspace,
    profile: "agentmo-poc-runtime-seam",
    model: "deepseek/test-model",
    message: "Return bounded test output.",
    runtimeEnvFile: envFile,
    runCommand: async () => {
      effects.push("runCommand");
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
    ...ANTI_BYPASS_OPTIONS,
  }));
});

assert.deepEqual(effects, []);
await assertPathAbsent(profileHome);
```

Also assert the rejection has no `pocDiagnostic`, does not contain the temp
root or test secret, and remains the fixed runtime error.

- [ ] **Step 5: Add the gateway zero-effect test**

Add a test named exactly:

```text
rejects POC OpenClaw gateway before port, profile, token, setup, gateway, readiness, or browser effects
```

Use the same fixture pattern and collect these exact effect labels through
injected callbacks:

```js
const effects = [];
const options = {
  workspace,
  profile: "agentmo-poc-dashboard-seam",
  model: "deepseek/test-model",
  runtimeEnvFile: envFile,
  port: 18889,
  checkPort: async () => { effects.push("checkPort"); return true; },
  gatewayTokenFactory: () => { effects.push("gatewayTokenFactory"); return "test-only-gateway-token"; },
  runCommand: async () => { effects.push("runCommand"); return { exitCode: 0, stdout: "{}", stderr: "" }; },
  runGateway: async () => { effects.push("runGateway"); return 0; },
  onReady: async () => { effects.push("onReady"); },
  openDashboard: async () => { effects.push("openDashboard"); },
  ...ANTI_BYPASS_OPTIONS,
};
```

Under `INCOMPATIBLE_CONTRACT_VERSION`, require the fixed unsupported-runtime
error, `effects` to equal `[]`, and `.agentmo-poc-home` to remain absent.

- [ ] **Step 6: Strengthen browser invalid-input no-spawn behavior**

In `test/poc-openclaw-runtime.test.js`, add a test named exactly:

```text
rejects invalid Dashboard browser URLs and tokens without spawning a local UI child
```

Use a `spawnCalls` counter and call `openPocDashboardUrl` with invalid HTTPS,
non-`127.0.0.1` host, invalid port/path/session, missing token, and empty token
URLs. Every case must throw `AGENTMO_POC_DASHBOARD_URL_INVALID`; after all
cases, assert `spawnCalls === 0` and that serialized errors do not contain the
URL/token canary. Keep the existing valid Darwin fake-child test unchanged.

- [ ] **Step 7: Add separate final-barrier marker tests**

In `test/runtime-compatibility-seams.test.js`, import `chmod` and create a
test-only executable under a fresh temp directory. Its complete content is:

```js
const markerExecutable = path.join(root, "marker-child");
await writeFile(
  markerExecutable,
  `#!/bin/sh\nprintf '%s' spawned > ${JSON.stringify(marker)}\n`,
  { encoding: "utf8", mode: 0o700 },
);
await chmod(markerExecutable, 0o700);
```

Add a helper that begins with a supported simulated version, then installs a
non-enumerable getter on one options object property. The getter changes
`process.versions.node` to `INCOMPATIBLE_CONTRACT_VERSION` and returns
`undefined`, selecting the default private helper only at the final seam. The
helper must restore the original runtime descriptor in `finally`:

```js
function switchRuntimeAtDefaultHelper(options, property) {
  const original = Object.getOwnPropertyDescriptor(process.versions, "node");
  Object.defineProperty(process.versions, "node", { ...original, value: "24.0.0" });
  Object.defineProperty(options, property, {
    configurable: true,
    enumerable: false,
    get() {
      Object.defineProperty(process.versions, "node", {
        ...original,
        value: INCOMPATIBLE_CONTRACT_VERSION,
      });
      return undefined;
    },
  });
  return () => Object.defineProperty(process.versions, "node", original);
}
```

Add these exact tests:

```text
keeps the ordinary POC OpenClaw final child barrier from spawning after runtime authority changes
keeps the POC gateway final child barrier from spawning after runtime authority changes
```

For the ordinary-command case, use a valid POC workspace/runtime-env fixture,
set `executable: markerExecutable`, install the non-enumerable `runCommand`
getter, and call `runPocOpenClaw`. The public entry guard passes under `24.0.0`;
the getter changes the version immediately before selection of
`executePocOpenClawCommand`. Require the fixed unsupported-runtime error and
`assertPathAbsent(marker)`.

For the gateway case, use valid Dashboard inputs, inject successful
`checkPort` and `runCommand` callbacks so no real setup child runs, set
`executable: markerExecutable`, install the non-enumerable `runGateway` getter,
and call `runPocOpenClawDashboard`. Require the same fixed runtime error, no
`onReady`/browser call, and `assertPathAbsent(marker)`. The property must be
non-enumerable so the earlier `{ ...options }` command-building spread does not
trigger the transition prematurely.

These two tests are behavioral proof for the site-local barriers. Keep the
source-order assertions as an additional maintenance check, not as their
substitute. No marker executable may actually run in the GREEN result.

- [ ] **Step 8: Run RED and preserve the exact cause**

Run:

```bash
node --test test/runtime-compatibility-seams.test.js test/poc-openclaw-runtime.test.js
```

Expected: exit 1. Both hostile-options tests reach the `get` trap, and the
entry external zero-effect/ordering assertions fail because the public POC
flows do not call the repository runtime guard. The final-barrier tests also
fail because the private helpers reach the marker child or a child startup path
instead of returning the fixed runtime rejection. The browser invalid-input
test may already pass; it does not make the aggregate GREEN.

### Task 2: GREEN — add the early and site-local repository guards

**Files:**
- Modify: `src/poc-openclaw-runtime.js`
- Test: `test/runtime-compatibility-seams.test.js`
- Test: `test/poc-openclaw-runtime.test.js`

**Interfaces:**
- Consumes: `assertCurrentOpenClawTargetRuntime(): Readonly<CurrentRuntimeObservation>` from `src/runtime-compatibility.js`.
- Produces: unchanged public POC signatures with an earlier fixed rejection on unsupported current processes.

- [ ] **Step 1: Import only the existing zero-argument authority**

Add in lexical import order:

```js
import { assertCurrentOpenClawTargetRuntime } from "./runtime-compatibility.js";
```

Do not add an options field, provider, alternate version, environment lookup,
or wrapper function accepting arguments.

- [ ] **Step 2: Guard both public effectful flows before option access**

Make the first executable statement in each public flow exactly:

```js
export async function runPocOpenClaw(options) {
  assertCurrentOpenClawTargetRuntime();
  const workspace = path.resolve(options.workspace);
  // existing body unchanged
}

export async function runPocOpenClawDashboard(options) {
  assertCurrentOpenClawTargetRuntime();
  const workspace = path.resolve(options.workspace);
  // existing body unchanged
}
```

Do not catch or translate the guard error. This ordering must precede workspace
inspection, environment-file access, port checks, directory creation, token
generation, command construction, or callbacks.

- [ ] **Step 3: Guard the two real OpenClaw spawn helpers locally**

Add a direct zero-argument check before constructing either child:

```js
function executePocOpenClawCommand(command) {
  return new Promise((resolve, reject) => {
    assertCurrentOpenClawTargetRuntime();
    const child = spawn(command.executable, command.args, {
      // existing options unchanged
    });
    // existing lifecycle unchanged
  });
}

function executePocGateway(command, { port, onListening }) {
  return new Promise((resolve, reject) => {
    assertCurrentOpenClawTargetRuntime();
    const child = spawn(command.executable, command.args, {
      // existing options unchanged
    });
    // existing lifecycle unchanged
  });
}
```

Do not add the runtime guard to `openPocDashboardUrl`.

- [ ] **Step 4: Run GREEN**

Run:

```bash
node --test test/runtime-compatibility-seams.test.js test/poc-openclaw-runtime.test.js
```

Expected: exit 0, all tests pass, no real OpenClaw/browser child is launched.
Both hostile-options trap count objects must contain four explicit zeros, both entry-layer effect arrays
must be empty, and both final-barrier marker files must remain absent, proving
each boundary independently.

- [ ] **Step 5: Confirm the authority itself was not changed**

Run:

```bash
node --test test/runtime-compatibility.test.js
node --check src/poc-openclaw-runtime.js
```

Expected: both commands exit 0. Export set, exact range, zero-argument guard,
fixed codes, anti-override checks, and syntax remain unchanged.

### Task 3: REFACTOR — keep inventory explicit and run focused compatibility gates

**Files:**
- Modify only if needed: `test/runtime-compatibility-seams.test.js`
- Modify only if needed: `test/poc-openclaw-runtime.test.js`
- Review: `src/poc-openclaw-runtime.js`
- Review: `scripts/node20-core-receipt.js`
- Review: `scripts/node20-distribution-trust.json`

**Interfaces:**
- Consumes: the GREEN guard placement and test-owned three-site inventory.
- Produces: readable helpers without changing product capability, command-manifest membership, or trust anchors; expected counts change only to the frozen measured population.

- [ ] **Step 1: Refactor test duplication only while green**

If the two runtime-rejection tests duplicate fixture setup, extract only:

```js
async function createPocRuntimeSeamFixture(prefix) {
  const root = await mkdtemp(path.join(tmpdir(), prefix));
  const workspace = path.join(root, "workspace");
  const envFile = path.join(root, "runtime.env");
  await writePocWorkspace(pocRuntimeSeed(), workspace);
  await writeFile(envFile, "DEEPSEEK_API_KEY=test-only-provider-secret\n", "utf8");
  return Object.freeze({ root, workspace, envFile, profileHome: path.join(workspace, ".agentmo-poc-home") });
}
```

Do not abstract the three site classifications into production code and do not
collapse command/gateway/browser assertions into a count-only assertion.

- [ ] **Step 2: Re-run the RED/GREEN suite after refactor**

```bash
node --test test/runtime-compatibility-seams.test.js test/poc-openclaw-runtime.test.js
```

Expected: exit 0 with no failures.

- [ ] **Step 3: Run the Node20 runner/lane and compatibility focused set**

```bash
node --test test/runtime-compatibility.test.js test/runtime-compatibility-seams.test.js test/poc-openclaw-runtime.test.js test/node20-core-runner.test.js test/node20-core-lane.test.js
```

Expected: exit 0; only the existing environment-conditional actual-lane skip
is permitted. The next trusted producer must prove syntax 42/42,
core contracts 62 pass + 1 skip out of 63, and Stage contracts 3 pass + 2
skips out of 5. The ordinary host snapshot before the new regressions was
57/1/58; the earlier official lane snapshot was 59/1/60 because it activated
two producer-only tests. `CORE_TEST_FILES` remains five files, while its
test-case population grew through the new regressions.

The later official Node.js 20 diagnostic measured `62/1/0/63` under candidate
command-set digest
`6686c2ef35269bb43babe6d3e37bd567e02976637e05613ddd2508161c4405e8`.
Treat it only as count measurement. Adding the separately owned
`src/agent-idea-candidate-cli.js` syntax member invalidated the prior
`fa7f2f…` command set without changing the core membership or counts. The
first post-split module-computed
`9bc48f13d8f8a160c8da869fb57d3dd398e56ab115ba9d655ec66fc2abbdab51`
digest was used by trusted producer attempt 1. That attempt failed closed with
exit 1 and `AGENTMO_NODE20_LANE_TAP_COUNT_MISMATCH`, created no temporary
receipt, and published no public receipt. Its stale Stage expected count was
`3/1/0/4`; the official Node.js 20 direct Stage diagnostic was `3/2/0/5`,
exit 0. The fifth Phase 4 non-transitive test has existed since `ec2f10d` and
is skipped because it does not match the fixed Stage 1/2/3 handoff pattern.
The corrected current module-computed digest is
`455e7d36ab8eb2334e0854977063637cc79bc9b9734fd3c3df2bfa6ea86894e2`.
Trusted producer attempt 2 subsequently bound this digest to the exact
published receipt with SHA-256
`64fd5deba66e05c94c176934a5472ecdebc15a85ac63d943257d1bc0480be538`.
That receipt remains bounded mechanism evidence rather than domain,
production, provider-success, or wider OpenClaw certification.

- [ ] **Step 4: Run selected Stage 1/2 authority regression**

```bash
node --test test/artifact-admission.test.js test/design-plan.test.js test/user-need.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
```

Expected: exit 0. No artifact, Plan, approval, runtime target, or digest
authority changes are allowed from this maintenance fix.

### Task 4: Re-run the trusted Node.js 20 producer and publish only exact successful bytes

**Files:**
- Create on producer success only: `release/evidence/2026.08.14-node20-core-receipt.json`
- Preserve byte-for-byte: `release/evidence/2026.07.13-node20-core-receipt.json`
- Modify after publication: `test/runtime-evidence-consumers.test.js`
- Modify after publication: `docs/RUNTIME_COMPATIBILITY.md`
- Modify after publication: `release/2026.08.14.md`
- Modify only if its maintained contract requires the new evidence row: `release/README.md`

**Interfaces:**
- Consumes: official Node.js 20.20.2 darwin-arm64 archive/checksum inputs, repository-owned `scripts/node20-distribution-trust.json`, current `OWNED_COMMAND_MANIFEST`, and the GREEN seam tests.
- Produces: one new exact Node.js 20 receipt and maintained consumers bound to its actual digest/counts.

- [ ] **Step 1: Re-establish official input trust before extraction or execution**

Create a fresh random `/private/tmp/agentmo-node20.XXXXXXXX` directory if the
prior isolated directory is unavailable. Download only:

```text
https://nodejs.org/dist/v20.20.2/node-v20.20.2-darwin-arm64.tar.gz
https://nodejs.org/dist/v20.20.2/SHASUMS256.txt
```

Before extraction, require these exact SHA-256 values and the exact archive
entry in `SHASUMS256.txt`:

```text
archive: 466e05f3477c20dfb723054dfebffe55bc74660ee77f612166fca121dacb65b6
SHASUMS256.txt: c6f74825d6ddf350ef06600c67fec6ea2f7996cf438a78c3cb2a89b29d4320ed
archive member/executable: 38de4fc456c0c439bac48c727d378f749abb4e31f4116703bb1ee9a746fccbb6
```

After extraction, require canonical realpath containment, executable hash,
`process.versions.node === "20.20.2"`, and `process.arch === "arm64"`. Stop on
any mismatch. Do not modify `PATH` or install Node globally.

- [ ] **Step 2: Run the producer into a new absent temporary receipt**

Set shell-local path variables only after the preceding validations; they are
not trust-anchor overrides. Confirm the receipt path does not exist, then run:

```bash
npm run check:core:node20 -- \
  --node-bin "$agentmo_node20_bin" \
  --archive "$agentmo_node20_archive" \
  --checksums "$agentmo_node20_checksums" \
  --expected-version 20.20.2 \
  --expected-arch arm64 \
  --receipt "$agentmo_node20_new_receipt"
```

Expected: exit 0 and an exact receipt reporting:

```text
command-set-sha256=455e7d36ab8eb2334e0854977063637cc79bc9b9734fd3c3df2bfa6ea86894e2
syntax=42/0/0/42
core-contracts=62/1/0/63
stage-contracts=3/2/0/5
```

Receipt shape accepts non-negative integer skips for every batch. Exact batch
counts remain exclusively bound by `assertNode20Receipt` against
`OWNED_COMMAND_MANIFEST`; arbitrary skip values, wrong batch IDs, lengths,
totals, failures, digests, and provenance remain rejected.

If the producer exits nonzero, preserve the first real failure, publish
nothing, and do not edit consumer/docs to claim success.

- [ ] **Step 3: Validate and publish byte-identical receipt bytes**

Use `readNode20Receipt` from `scripts/node20-core-receipt.js` to validate the
temporary receipt against the current manifest. Confirm
`release/evidence/2026.08.14-node20-core-receipt.json` is absent. Record the
historical receipt SHA-256, publish the temporary receipt's exact bytes as the
new file, and require:

```bash
cmp -s "$agentmo_node20_new_receipt" release/evidence/2026.08.14-node20-core-receipt.json
shasum -a 256 "$agentmo_node20_new_receipt" release/evidence/2026.08.14-node20-core-receipt.json release/evidence/2026.07.13-node20-core-receipt.json
```

Expected: `cmp` exit 0; temporary and published SHA-256 values are identical;
the historical receipt remains
`c06631d9ccb43ebb2b5cbf85a4f20cccc65421148d051cdb238fc96a1f1559bf`.

- [ ] **Step 4: RED — point the exact consumer at the new evidence**

In `test/runtime-evidence-consumers.test.js`, change the receipt and dated
release facts to the new `2026.08.14` evidence while retaining the checks that
the consumer is outside the producer manifest and historical marker/env values
cannot replace an exact receipt. Run:

```bash
node --test test/runtime-evidence-consumers.test.js
```

Expected: exit 1 until the compatibility matrix and release record contain the
new receipt SHA, current command-set digest, exact batch counts, and bounded
certification text.

- [ ] **Step 5: GREEN — update maintained evidence to actual producer facts**

Update `docs/RUNTIME_COMPATIBILITY.md` and `release/2026.08.14.md` with the
actual receipt SHA-256, current command-set digest, syntax/core/stage counts,
producer command, post-publication consumer result, and non-certification
boundary. Remove the obsolete “official inputs unavailable” blocker but retain
the historical receipt record and the prior full-check timeline. Update
`release/README.md` only if the consumer's maintained dated-row contract needs
the `2026.08.14` evidence description.

Run:

```bash
node --test test/runtime-evidence-consumers.test.js
```

Expected: 6 pass, 0 fail, exit 0. The consumer must not enter the producer
manifest or accept caller/environment trust-marker substitution.

### Task 5: Final focused verification and one aggregate check

**Files:**
- Review every path modified in Tasks 1–4.

**Interfaces:**
- Consumes: guarded spawn seams, exact new receipt, and maintained public evidence.
- Produces: complete verification evidence for control-session review; no commit or publication action.

- [ ] **Step 1: Run all focused runtime and receipt suites**

```bash
node --test test/runtime-compatibility.test.js test/runtime-compatibility-seams.test.js test/poc-openclaw-runtime.test.js test/node20-core-runner.test.js test/node20-core-lane.test.js test/runtime-evidence-consumers.test.js
```

Expected: exit 0; no failures and only the documented environment-conditional
actual-lane skip.

- [ ] **Step 2: Run Stage 1/2 and Candidate authority regressions**

```bash
node --test test/artifact-admission.test.js test/artifact-contract.test.js test/artifact-subjects.test.js test/artifact-surface-coverage.test.js test/agent-idea-candidate.test.js test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
```

Expected: exit 0. The runtime maintenance fix and receipt publication must not
change artifact admission, Candidate proposal-only status, or Plan authority.

- [ ] **Step 3: Syntax-check every changed JavaScript file**

```bash
node --check src/poc-openclaw-runtime.js
node --check test/runtime-compatibility-seams.test.js
node --check test/poc-openclaw-runtime.test.js
node --check test/runtime-evidence-consumers.test.js
```

Expected: every command exits 0.

- [ ] **Step 4: Check the complete uncommitted diff**

```bash
git diff --check 5d3bff1..HEAD
git diff --check
git status --short
```

Expected: both diff checks exit 0. Status lists only the explicitly approved
source, tests, new receipt, design/plan, runtime compatibility doc, dated
release record, and any strictly required release index change.

- [ ] **Step 5: Run the full repository check exactly once**

```bash
npm run check
```

Expected success condition: final exit 0 with complete TAP output. Do not retry
automatically. If it exceeds 30 minutes with no new output or the same child
test stalled, report the process chain and elapsed time to the control session
before any interruption decision. If it fails, record the first real failure,
final exit/signal, and whether it is introduced, environmental, or a known
baseline issue; never weaken a gate to obtain green.

- [ ] **Step 6: Verification-before-completion review**

Confirm all of the following from fresh command output:

```text
two OpenClaw public flows reject before preparation on an unsupported runtime
hostile options receive zero get/has/ownKeys/descriptor traps at both entries
two private real-spawn helpers recheck the repository guard
browser invalid URL/token inputs never spawn and make no runtime claim
Node20 producer exit 0 and temporary receipt validated
new published receipt is byte-identical to temporary producer output
historical receipt hash unchanged
consumer 6/6 and focused suites exit 0
full check exact final outcome recorded
no .env, secret, host-private path, raw output, OpenClaw execution, or global runtime mutation
```

Do not stage or commit until the control session obtains explicit user
authorization. When authorization is later granted, stage explicit paths only.
