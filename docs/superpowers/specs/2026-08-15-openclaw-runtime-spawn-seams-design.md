# OpenClaw Runtime Spawn Seams Design

## Status

Approved for implementation on 2026-08-15 by the AgentMo control session.
This record closes the maintenance-contract drift exposed by the trusted
Node.js 20 producer. It does not add an OpenClaw capability or authorize a
live OpenClaw run.

## Problem

The repository-owned Node.js 20 producer owns
`test/runtime-compatibility-seams.test.js`. Its current spawn inventory expects
one child-process site in `src/poc-openclaw-runtime.js`, while that module now
contains three:

1. the ordinary OpenClaw command executor;
2. the long-running OpenClaw gateway executor;
3. the local browser opener for an authenticated loopback Dashboard URL.

The first two sites can start the OpenClaw target and therefore require the
repository-owned current-process OpenClaw runtime authority. The browser site
is a local UI effect, not an OpenClaw runtime child. Treating all three as one
undifferentiated count would erase that authority distinction and would make a
green producer receipt overstate the tested boundary.

## Site classification and ownership

| Site ID | Private implementation | Classification | Owning public flow | Required boundary |
| --- | --- | --- | --- | --- |
| `poc-openclaw-command-child` | `executePocOpenClawCommand` | `openclaw-runtime-child` | `runPocOpenClaw`, `runPocOpenClawDashboard` setup commands | current OpenClaw runtime guard before preparation and again before the real spawn |
| `poc-openclaw-gateway-child` | `executePocGateway` | `openclaw-runtime-child` | `runPocOpenClawDashboard` | current OpenClaw runtime guard before preparation and again before the real spawn |
| `poc-dashboard-browser-child` | `openPocDashboardUrl` | `local-ui-child` | authenticated loopback Dashboard opener | strict URL/token validation before browser spawn; no OpenClaw runtime claim |

The classification belongs to the maintenance test contract. It is not a new
public production registry or a durable artifact.

## Runtime authority and call order

`src/poc-openclaw-runtime.js` will import and directly invoke the existing
zero-argument repository authority:

```js
assertCurrentOpenClawTargetRuntime();
```

No option, callback, environment variable, version string, or caller-provided
provider may influence that call. The existing guard continues to observe
`process.versions.node` and enforce the exact repository range
`>=22.19.0 <23 || >=23.11.0`.

Each effectful public flow must execute the guard as its first statement:

```text
runPocOpenClaw
  -> assertCurrentOpenClawTargetRuntime
  -> resolve/check workspace
  -> read and validate runtime env
  -> create isolated profile directory
  -> materialize bounded command environment
  -> execute ordinary OpenClaw commands

runPocOpenClawDashboard
  -> assertCurrentOpenClawTargetRuntime
  -> resolve/check workspace
  -> read and validate runtime env
  -> validate/check loopback port
  -> create isolated profile directory
  -> create gateway token and bounded command environment
  -> execute setup commands
  -> execute gateway
  -> optionally invoke the separately validated browser opener
```

The two private helpers that contain the actual OpenClaw `spawn` calls also
invoke the same zero-argument guard immediately before constructing the child.
The entry guard supplies the required pre-preparation zero-effect boundary;
the site-local guard prevents a future internal caller from reaching a real
OpenClaw spawn without rechecking current-process authority.

These are two separately tested gates, not duplicate source-text assertions:

- **Entry gate:** simulate an incompatible runtime before invoking either
  public flow and prove workspace read, runtime-env read, port probe, `mkdir`,
  token/command materialization, injected runners, readiness, browser, and
  child effects all remain untouched. Each flow is also invoked with a hostile
  `Proxy` options object whose `get`, `has`, `ownKeys`, and
  `getOwnPropertyDescriptor` traps count and throw a private canary. All trap
  counts must remain zero, directly proving the first guard executes without
  reading `workspace`, `runtimeEnvFile`, credentials, port, callbacks, or any
  other caller property.
- **Final child-process barrier:** enter each public flow under a supported
  runtime, switch the simulated current-process version to incompatible only
  when the flow resolves its default private command/gateway helper, and use an
  isolated marker executable as the selected command. The private helper must
  reject with `AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED` and the marker must remain
  absent. This proves the site-local guard, rather than the earlier entry
  check, prevented the actual child spawn.

`openPocDashboardUrl` does not call the OpenClaw runtime guard. Its authority is
limited to a local browser program after validation of an `http:` URL whose
host is exactly `127.0.0.1`, port is in the maintained Dashboard range, path is
exactly `/chat`, session begins with `agent:`, and fragment contains a non-empty
`token`. Invalid URL or token input fails before selection or invocation of the
browser spawn callback.

## Zero-effect definition

When the current process is outside the OpenClaw target range, both public POC
flows must fail before all of the following:

- any read, enumeration, membership check, or property-descriptor lookup on
  the caller-supplied options object;
- workspace inspection or any directory creation;
- runtime environment-file read or `SecretPresence` construction;
- isolated profile path creation;
- loopback port probing or listener creation;
- gateway-token generation or credential-bearing command environment creation;
- command construction that embeds runtime credential values;
- injected or default `runCommand` execution;
- injected or default `runGateway` execution;
- `onReady` or `openDashboard` callbacks;
- any ordinary OpenClaw, gateway, or browser child spawn.

Tests may create isolated input fixtures before entering the simulated
incompatible runtime. Zero-effect means the product call does not create,
modify, or invoke anything after the guard is entered; it does not remove the
test's pre-existing fixtures.

For the browser opener, invalid URL/token zero-effect means the supplied
`spawnProcess` callback is never called. Browser rejection does not imply or
certify OpenClaw runtime compatibility.

## Failure and diagnostic boundary

Runtime rejection propagates the existing fixed error unchanged:

```text
code: AGENTMO_OPENCLAW_RUNTIME_UNSUPPORTED
message: Current process does not satisfy the OpenClaw target runtime range.
```

The POC layer must not wrap it in a POC diagnostic, add the observed version,
echo a path, expose environment values, or translate it into an OpenClaw
process failure. Calling the guard with any argument remains impossible in the
production path; the existing `AGENTMO_OPENCLAW_RUNTIME_INPUT_REJECTED`
anti-override contract remains unchanged.

Browser URL/token rejection continues to use the fixed
`AGENTMO_POC_DASHBOARD_URL_INVALID` code and must not echo the rejected URL or
token. Child startup errors after a valid browser request continue to use
`AGENTMO_POC_DASHBOARD_BROWSER_UNAVAILABLE`.

## Maintenance inventory contract

`test/runtime-compatibility-seams.test.js` will replace the bare
`src/poc-openclaw-runtime.js: 1` expectation with an explicit three-entry site
inventory containing stable site ID, classification, implementation function,
and owning public flow. It will verify:

- the ordinary command and gateway entries are `openclaw-runtime-child`;
- their owning public flows perform the repository guard before preparation;
- hostile Proxy options receive zero property traps at both public entries,
  and trap canaries never appear in the fixed runtime error;
- the private real-spawn helpers perform the guard immediately before spawn;
- simulated incompatible runtime produces the fixed rejection and all tracked
  effects remain zero;
- a supported-entry/incompatible-final-barrier transition leaves both ordinary
  command and gateway marker files absent, separately proving no child spawn;
- the browser entry is `local-ui-child`, has no OpenClaw runtime claim, and is
  protected by URL/token validation plus no-spawn tests;
- the complete source-level production spawn inventory still matches exactly,
  so an unclassified fourth site fails closed.

`test/poc-openclaw-runtime.test.js` remains the behavioral owner for valid and
invalid browser opening. It will explicitly count `spawnProcess` calls across
invalid scheme, host, port/path/session, missing-token, and empty-token cases.
The valid-path regression reads `spawnProcess` through an accessor and requires
exactly one read. A nullish injected value retains the prior builtin fallback;
the builtin `spawn` binding is called only in an explicit branch and is never
stored in an alias.

The production source inventory uses the dedicated calls-only
`inventoryChildProcessCallSites` analysis. It reuses the repository tokenizer,
static module bindings, and call parser without changing the package analyzer.
Child-process authority is static-import-only: named and namespace direct calls
are classified for both `child_process` spellings. Binding escape/re-alias and
computed member access fail closed. Any code-level identifier or member
reference named `require`, `getBuiltinModule`, or `createRequire` fails closed,
as do dynamic or constructed child-process imports and every import, export, or
re-export from `module` or `node:module`. Static imports from `process` or
`node:process` also fail closed. The global `process` authority may appear only
as the base of a direct static dot-property read or call; computed access,
assignment, argument passing, and return/value escape are rejected. This also
closes bracket-string, escaped-string, template-property, `Reflect.get`, and
`.bind` routes to loader authority. This deliberately rejects an
otherwise local identifier with one of those loader names; conservative
rejection is the public boundary of this narrow maintenance inventory. The
tokenizer prevents loader-shaped comments, strings, non-expression template
text, and regular expressions from creating false references. The existing
`analyzeJavaScriptSource` package-admission behavior is unchanged.

## Node.js 20 recovery boundary

Closing these seams is a prerequisite, not a substitute, for Node.js 20
evidence. After the focused current-host tests pass, the trusted producer must
be rerun with the already approved official Node.js 20.20.2 darwin-arm64
distribution inputs and a new absent temporary receipt path. Publication is
allowed only if:

- archive, official checksum manifest, archive member, executable, version,
  architecture, canonical path, and repository-owned trust anchor all match;
- the producer exits 0 with syntax 42/42, core contracts 62 pass + 1 skip, and
  Stage contracts 3 pass + 2 skips with zero failures out of 5 tests;
- `readNode20Receipt` accepts the temporary receipt against the current command
  manifest;
- the new public receipt target does not already exist and the historical
  `2026.07.13` receipt remains byte-for-byte unchanged.

The receipt and compatibility rows prove only bounded mechanism execution.
They do not certify domain quality, production readiness, provider success, or
wider OpenClaw compatibility.

The count update is based on two bounded snapshots. Before the new adversarial
regressions, the ordinary host reported 57 pass + 1 skip out of 58; the fixed
official Node.js 20 lane activated two producer-only tests and reported 59
pass + 1 skip out of 60. After the inventory, helper-restoration, and receipt
shape regressions were frozen, one exact official Node.js 20 calls-only run
reported 62 pass + 1 skip, 0 fail, 63 total, exit 0. `CORE_TEST_FILES` remains
the same five files, but their test-case population changed. Adding the
separately owned `src/agent-idea-candidate-cli.js` syntax member changes the
syntax batch from 41/41 to 42/42 without changing those core counts. The
first post-split repository-computed command-set digest was
`9bc48f13d8f8a160c8da869fb57d3dd398e56ab115ba9d655ec66fc2abbdab51`.
Trusted producer attempt 1 ran under that digest and failed closed with exit 1
and `AGENTMO_NODE20_LANE_TAP_COUNT_MISMATCH`: the manifest expected Stage
`3/1/0/4`, while the official Node.js 20 direct diagnostic produced
`3/2/0/5`. The fifth Phase 4 non-transitive test has existed since `ec2f10d`;
it does not match the fixed `Stage 1|Stage 2|Stage 3 handoff` pattern and is
therefore reported as the second skip, not as a test failure. Attempt 1 wrote
no temporary receipt and no public receipt was published.

Correcting only that stale Stage count produces the current module-computed
digest
`455e7d36ab8eb2334e0854977063637cc79bc9b9734fd3c3df2bfa6ea86894e2`.
The prior `9bc48f…` digest is now an expired failed-attempt candidate; the prior
`fa7f2f…` digest did not own the new syntax file and was already obsolete.

The `62/1/63` official Node.js 20 diagnostic ran while the module still carried
the candidate command-set digest
`6686c2ef35269bb43babe6d3e37bd567e02976637e05613ddd2508161c4405e8`.
That earlier diagnostic is count measurement only. Trusted producer attempt 2
subsequently bound the current `455e7d…` digest to the exact published receipt
whose SHA-256 is
`64fd5deba66e05c94c176934a5472ecdebc15a85ac63d943257d1bc0480be538`.
The receipt is bounded mechanism and distribution-provenance evidence, not
domain, production, provider-success, or wider OpenClaw certification.

Published-receipt shape validation now owns only batch type and arithmetic:
`skip` is any non-negative safe integer. `assertNode20Receipt` remains the
authority that binds every batch to the exact `OWNED_COMMAND_MANIFEST` counts.
This removes the obsolete index-based assumption that only Stage contracts may
skip without weakening batch identity, fail, total, digest, or provenance
checks. Producer attempt 1 failed closed before receipt creation. Producer
attempt 2 published the exact receipt bytes, and the updated post-publication
consumer passed 6/6 with exit 0. At that evidence checkpoint, command-docs and
the full `npm run check` aggregate had not yet run.

## Rejected alternatives

- **Change the expected count from one to three.** Rejected because it would
  inventory bytes without classifying authority or proving zero-effect.
- **Treat the browser opener as an OpenClaw runtime launch.** Rejected because
  it is a local UI child and would create a false compatibility claim.
- **Guard only immediately before `spawn`.** Rejected because runtime env,
  profile, token, and credential preparation would already have occurred.
- **Guard only the public entry points.** Rejected because a future internal
  caller could reach a private real-spawn helper without a site-local check.
- **Accept a version/provider callback or environment marker.** Rejected because
  runtime authority is repository-owned and current-process-only.
- **Remove the compatibility test from the Node.js 20 manifest.** Rejected as a
  weakening of the producer evidence boundary.
- **Overwrite the historical receipt or edit evidence without producer
  success.** Rejected because published evidence is append-only and must bind
  exact producer bytes.

## Test strategy

Implementation follows RED/GREEN/REFACTOR:

1. Add explicit site classification, hostile-Proxy no-option-read tests, two
   incompatible-runtime external zero-effect tests, and two
   supported-entry/incompatible-barrier marker tests; confirm they fail against
   the unguarded flows/helpers.
2. Add the minimal direct guard import and ordered calls; confirm the focused
   suites pass without executing real OpenClaw.
3. Refactor only test helpers/inventory representation while green; do not
   change product capability.
4. Run runtime compatibility, POC, Node.js 20 runner/lane, syntax, receipt
   consumer, and Stage 1/2 selected regressions.
5. Run the trusted Node.js 20 producer, publish only successful exact receipt
   bytes, update maintained evidence, and then run the consumer.
6. Only after all focused gates are green, run one `npm run check` and preserve
   its exact final outcome.

No test in this work launches OpenClaw. All mutation assertions use simulated
incompatible current-process versions, injected counters, absent paths, and
local fake child emitters.

## Non-goals

- running or installing OpenClaw, plugins, schedules, delivery, or providers;
- changing the supported OpenClaw Node range or Node distribution trust;
- adding a runtime-version option, bypass, environment marker, or caller-owned
  authority;
- changing POC command contents, profile semantics, credentials, ports, or
  browser behavior for valid inputs;
- expanding AgentMo product capability or claiming production readiness;
- changing the Node.js 20 command manifest membership or trust anchor;
- modifying or replacing the historical `2026.07.13` receipt;
- committing, pushing, merging, opening a PR, tagging, or publishing a GitHub
  Release without separate authorization.
