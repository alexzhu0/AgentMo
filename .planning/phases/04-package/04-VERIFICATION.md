---
phase: 04-package
verified: 2026-07-30T05:26:08Z
status: gaps_found
score: "2/5 roadmap must-haves verified"
plan_score: "47/59 plan truths verified"
requirements_score: "5/11 requirements satisfied"
behavior_unverified: 0
overrides_applied: 0
mvp_user_story_valid: false
next_action: "Close the Phase 4 authority, transaction, receipt, and lifecycle gaps before Phase 5; separately normalize the MVP goal or remove the inconsistent mode marker."
next_command: "/gsd:plan-phase 04 --gaps"
gaps:
  - truth: "Apply performs a fresh, trustworthy OpenClaw probe immediately before every target mutation, and target or probe drift invalidates the approval."
    status: failed
    reason: "The public CLI passes no adapters, while reprobe() returns the already admitted probe when adapters or adapters.reprobe are absent. Carrier admission is parsed by identity only, the probe schema is self-asserted, and the probe closes its verified executable handle before spawning the pathname without an explicit cwd."
    artifacts:
      - path: "src/cli.js"
        issue: "openclaw-install-apply calls the transaction without a reprobe adapter."
      - path: "src/openclaw-install-transaction.js"
        issue: "reprobe() treats the old probe as the current probe and carrier validation checks only optional fields."
      - path: "src/openclaw-probe.js"
        issue: "The retained target-member read is separated from later pathname execution, and spawn inherits the repository cwd."
      - path: "src/openclaw-probe-contract.js"
        issue: "Validation proves internal shape/hash consistency, not that the observations came from the approved probe implementation."
    missing:
      - "A non-optional production reprobe implementation invoked by the public apply route."
      - "Exact companion-backed carrier admission and non-self-authenticating probe provenance."
      - "Retained executable authority through execution, or an equivalent race-safe launch design, with an explicit disposable cwd."
  - truth: "Ordinary, sensitive-action, and conflict approvals are one-use exact authorities, and credential setup can invoke only the approved official auth route."
    status: failed
    reason: "Every apply constructs usedNonces as an empty in-memory array and never durably consumes a nonce. The credential handoff accepts any openclaw argv except a small blacklist; a safe in-memory reproduction accepted `openclaw plugins install evil` as credential setup."
    artifacts:
      - path: "src/openclaw-install-approval.js"
        issue: "Validators can reject a supplied used nonce, but no durable consumption mechanism exists."
      - path: "src/openclaw-install-transaction.js"
        issue: "Each apply starts with usedNonces: [] and receipts do not record consumed authority."
      - path: "src/openclaw-credential-handoff.js"
        issue: "The route checks executable/kind and a blacklist, not an exact auth-command allowlist or full decision contract."
    missing:
      - "Durable, atomic one-use nonce consumption bound to the receipt or recovery record."
      - "An exact allowlist/grammar for official OpenClaw credential/auth commands."
      - "Full exact sensitive-decision validation at the credential seam."
  - truth: "Managed-path mutation and automatic recovery cannot escape the target root or remove unknown, modified, or pathname-replaced assets."
    status: failed
    reason: "Managed paths are only lexically contained; ancestor directories are not retained/revalidated and writeFile follows a symlinked ancestor. Automatic recovery trusts cached same-process booleans for WeakSet-tagged entries and then unlinks by pathname, leaving a replacement window after observation."
    artifacts:
      - path: "src/openclaw-install-transaction.js"
        issue: "resolveManagedPath is lexical, only the immediate parent is lstat'ed, writeFile uses the pathname, and recovery later unlinks the pathname from cached predicates."
    missing:
      - "No-follow retained directory-chain traversal and effect execution relative to retained handles."
      - "Final-window identity/digest/owner revalidation coupled to deletion."
      - "Regression tests for ancestor-symlink swaps and post-observation pathname replacement."
  - truth: "A complete install receipt proves every managed and external effect succeeded and itemizes the exact plan, approvals, consumed nonces, and bounded external results."
    status: failed
    reason: "The validator accepts status complete with preserved operations and non-empty preservedAssets. The transaction collects externalResults but buildReceipt neither accepts nor serializes them, and the receipt schema omits plan/approval digests, nonces, decisions, and sensitive-action results."
    artifacts:
      - path: "src/openclaw-install-receipt.js"
        issue: "completeStatus rejects failed operations but permits preserved outcomes/assets; the closed key set has no effect-authority/result ledger."
      - path: "src/openclaw-install-transaction.js"
        issue: "externalResults is passed to buildReceipt but dropped by its parameter list and output object."
    missing:
      - "Fail-closed complete semantics requiring every required operation/action to be positively observed as applied/succeeded and no preserved assets."
      - "Receipt fields binding install-plan digest, approval digests, consumed nonces, sensitive decisions, and bounded external action results."
      - "Negative tests proving false-complete and omitted-effect receipts are rejected."
  - truth: "Install, upgrade, explicit rollback, and uninstall execute through one complete production seam with minimal config patches and a wired official credential route."
    status: failed
    reason: "The public transaction implements only absent-file write creation. Patch, remove, replacement, rollback, and uninstall effects return preserved/unsupported; the CLI supplies neither a sensitive-action runner nor the credential handoff. A caller-supplied absent-genesis builder also self-certifies arbitrary absence claims."
    artifacts:
      - path: "src/openclaw-install-transaction.js"
        issue: "applyOperation rejects every non-write or non-create operation as unsupported."
      - path: "src/cli.js"
        issue: "The advertised four-lifecycle apply command passes no production external-action adapter."
      - path: "src/openclaw-credential-handoff.js"
        issue: "The module is packed and tested but is not wired into the production apply route."
      - path: "src/openclaw-install-plan.js"
        issue: "buildOpenClawAbsentGenesisAuthority sets verifiedAbsent=true from caller-provided fields without observing the filesystem."
    missing:
      - "Race-safe patch/remove/upgrade/rollback/uninstall effect implementations."
      - "A production sensitive-action dispatcher that routes credential actions through the exact official seam."
      - "A filesystem-observed absent-genesis producer rather than caller-attested absence."
  - truth: "Package and target-authority publishers remove only the exact outputs they created when a post-publication failure occurs."
    status: failed
    reason: "Package Produce and the target descriptor/admission writers remember only that publication happened, then remove the final pathname on failure. They do not retain and compare the published identity before cleanup, so a replacement can be deleted."
    artifacts:
      - path: "src/package-produce.js"
        issue: "Failure cleanup recursively removes outputRoot/archivePath by pathname after commit."
      - path: "src/openclaw-target-admission.js"
        issue: "Partial-output cleanup unlinks filePath without retained-identity comparison."
      - path: "src/openclaw-target-descriptor.js"
        issue: "Partial-output cleanup unlinks filePath without retained-identity comparison."
    missing:
      - "Retained published identities and identity-safe cleanup for directory, archive, descriptor, and admission outputs."
      - "Final-window replacement tests for every create-only publisher."
---

# Phase 4: 确定性 Package 与所有权安全安装 Verification Report

**Phase Goal:** 开发者可以把经批准的 build contract 确定性生成成可离线检查的最小信任面 Agent Package，并在 probe、预览和 exact-plan 批准后安全安装到 OpenClaw。

**Verified:** 2026-07-30T05:26:08Z
**Status:** `gaps_found`
**Re-verification:** No — initial verification
**Verdict:** The deterministic package and offline-inspection outcomes are real. The safe OpenClaw installation outcome is not achieved. Passing tests exercise the intended fixture path, while the public authority and mutation seams still permit stale probes, replayed approvals, arbitrary credential commands, unsafe pathname effects/recovery, false-complete receipts, and incomplete lifecycle execution.

## Escalation Gate

ROADMAP marks Phase 4 as `mode: mvp`, but the phase goal fails the canonical `user-story.validate` format guard. A formal MVP outcome-clause certification therefore cannot be emitted. This report continues as a conservative technical goal-backward verification so the observable safety blockers are not hidden. Before a future pass, the developer must either normalize the goal through `/gsd:mvp-phase 4` or remove the inconsistent MVP marker.

## User Flow Coverage

Because the MVP format guard failed, this is a technical decomposition of the current goal, not a valid User Story certification.

| Step | Expected | Actual codebase evidence | Status |
| --- | --- | --- | --- |
| Select approved inputs | Exact Phase 3 contract, target descriptor, and carrier admission are independently digest-bound | Current target/carrier admission is `sha256:554970...bf6`; target descriptor is `sha256:0abad6...bee`; both describe OpenClaw `2026.7.1-2@0790d9f` | VERIFIED |
| Produce package | Repeating Produce yields the same logical files, digests, manifest, and archive | The checked-in archive rebuild is byte-identical; 40 members, manifest `sha256:af98b4...c45`, archive `sha256:7726d7...55f`; named determinism test passes | VERIFIED |
| Inspect offline | Directory and archive expose the complete value-blind review model without installation | Directory/archive candidates are identical and expose files, carriers, permissions, sensitive actions, operations, evidence boundary, and risks; named hostile-material inspection tests exist | VERIFIED |
| Probe and preview | Exact target state is freshly observed immediately before mutation, and any drift invalidates authority | Fixture probe passes, but apply reuses the old probe by default; probe execution has a pathname TOCTOU/cwd gap and carrier/probe admission is self-authenticating at apply | FAILED |
| Approve exact effects | Ordinary, sensitive, and conflict authorities are exact, one-use, and route only approved actions | Nonces are never durably consumed; a forged credential proposal/decision executes arbitrary non-auth OpenClaw argv through the purported official route | FAILED |
| Apply and receive receipt | All four lifecycle actions preserve unknown/modified state and a complete receipt proves every effect | Only create-write effects execute; path/recovery cleanup is unsafe; receipts can be false-complete and omit external effect evidence | FAILED |
| Outcome | The package is safely installable after probe, preview, and exact approval | Deterministic package exists, but the safe-install portion of the goal is not achieved | FAILED |

## Goal Achievement

### Roadmap Observable Truths

| # | Truth | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Repeating Produce from the same approved contract yields identical logical content, per-file digests, canonical manifest, and a deterministically rebuildable archive | VERIFIED | Independent rebuild matched the checked-in `.d42` bytes; the named determinism test passed. |
| 2 | A developer can inspect the complete package offline and the package excludes secrets, auth/session state, runtime databases, and raw private transcripts | VERIFIED | Directory/archive inspection produced the same 40-member value-blind candidate; the named inspection test passed. Matches in policy text such as “session” or “sqlite-when-ready” are declarations, not embedded state/database files. |
| 3 | Carrier selection is least-trust and every capability/effect exposes exact authority; missing sensitive exact-action approval fails closed | FAILED | The package review model exposes carrier fields, but sensitive decisions are replayable and the credential seam accepts arbitrary OpenClaw commands. |
| 4 | Probe and preview bind the current OpenClaw capability/conflict state, and any plan or state drift invalidates approval before mutation | FAILED | Public apply performs no real fresh reprobe, carrier/probe authority is insufficiently grounded, and the probe launches a replaceable pathname from inherited cwd. |
| 5 | Install emits an itemized receipt and preserves unknown/modified assets across install, upgrade, rollback, and uninstall | FAILED | Managed effects/recovery are pathname-unsafe; only create-write is implemented; receipts omit external evidence and accept false-complete states. |

**Roadmap score:** 2/5 verified.
**Behavior-unverified:** 0. The failed runtime invariants have observable code/reproduction failures; they are not merely present-but-untested.

### Plan Must-Have Regression Ledger

| Plan | Verified | Result | Limiting evidence |
| --- | ---: | --- | --- |
| 04-01 | 6/6 | VERIFIED | Closed package/carrier contracts, least-trust mapping, target-neutral manifest, and D-42 inventory are substantive and tested. |
| 04-02 | 5/5 | VERIFIED (bounded) | Exact target/recipe/carrier authority exists and recomputed digests match; this certifies the selected fixture authority only. |
| 04-03 | 5/6 | FAILED | Deterministic executable materialization passes, but “complete and directly installable” is not achieved by the incomplete/unsafe lifecycle seam. |
| 04-04 | 4/4 | VERIFIED | Offline directory/archive inspection, semantic parity, closure checking, and hostile-material rejection are substantive. |
| 04-05 | 4/5 | FAILED | The normalized probe exists, but pathname execution and inherited cwd invalidate the promise that the approved target/operator state cannot be affected by a swapped executable. |
| 04-06 | 4/5 | FAILED | Pure plan/approval models exist; current target/ownership drift is not reliably invalidated before mutation because apply lacks a mandatory fresh probe. |
| 04-07 | 4/5 | FAILED | Create-only authorities and registry subjects exist; complete/incomplete receipt semantics are not substantive because false-complete receipts validate. |
| 04-08 | 4/5 | FAILED | Fresh-process artifact admission exists; absent genesis is caller-self-certified rather than produced by a trusted filesystem observation. |
| 04-09 | 1/7 | FAILED | D-42 archive closure is revalidated. Fresh probe, safe recovery, credential route, complete receipt, four lifecycle effects, and exact owner/base rechecks fail. |
| 04-10 | 4/5 | FAILED | Packed inventory/import and bounded fixture composition pass; packed tests do not make the unimplemented patch/remove/rollback/uninstall effects real. |
| 04-11 | 6/6 | VERIFIED (documentation) | Required docs/release/index/boundary text exists. Those documents describe the intended contract and do not override the implementation gaps found later. |

### Required Artifacts

| Artifact | Exists | Substantive | Wired | Final status | Details |
| --- | --- | --- | --- | --- | --- |
| `src/package-contract.js` / `src/package-carriers.js` | Yes | Yes | Yes | VERIFIED | Closed manifest/carrier validators feed build/Produce and tests. |
| `src/package-produce.js` / `src/package-archive.js` | Yes | Yes | Yes | VERIFIED WITH BLOCKER | Real 40-member package and deterministic archive flow exist; failure cleanup is replacement-unsafe. |
| `src/targets/openclaw-package.js` | Yes | Yes | Yes | WARNING | Real projection is produced; nested recipe paths are flattened with `basename`, allowing collisions for a valid future recipe. |
| `src/package-inspect.js` | Yes | Yes | Yes | VERIFIED | Reads directory/archive closure and renders one frozen candidate without OpenClaw invocation. |
| `src/artifact-registry.js` | Yes | Yes | Yes | VERIFIED | Automated pattern checking falsely reported missing literal identities because constants are imported; manual inspection confirms package-manifest and receipt descriptors are registered and wired. |
| `src/openclaw-target-descriptor.js` / `src/openclaw-target-admission.js` | Yes | Yes | Yes | VERIFIED WITH BLOCKER | Exact fixture authority works; create-only writer cleanup is pathname-unsafe. |
| `src/openclaw-probe.js` / `src/openclaw-probe-contract.js` | Yes | Yes | Yes | FAILED | Fixture probe works, but execution loses retained target identity and production apply does not call it freshly. |
| `src/openclaw-install-plan.js` / `src/openclaw-install-approval.js` | Yes | Yes | Yes | FAILED | Models are closed and digest-bound, but absent genesis self-certifies and nonces are not consumed. |
| `src/openclaw-install-receipt.js` | Yes | No | Yes | FAILED | Validator accepts false-complete receipts and schema omits exact external-effect authority/results. |
| `src/openclaw-install-transaction.js` | Yes | No | Yes | FAILED | Happy-path fixture install works; production reprobe, path safety, recovery, receipts, and four lifecycle effects do not satisfy the contract. |
| `src/openclaw-credential-handoff.js` | Yes | No | No production route | FAILED | Packed and test-imported only; accepts arbitrary non-auth OpenClaw argv and is not wired to CLI apply. |
| `src/cli.js` | Yes | Yes | Yes | UNSAFE | Commands are exposed, but apply supplies neither mandatory reprobe nor external-action adapters. |

The frontmatter artifact checker reported 43/45 literal-pattern checks passing. Its two failures in `src/artifact-registry.js` are checker false positives caused by imported identity constants, not stubs. Manual Level 2/3 inspection confirmed the descriptors. Manual verification also overturned the checker’s false-positive “immediate pre-effect re-probe” key-link result: the symbol exists, but the production route bypasses it.

### Key Link Verification

| From | To | Via | Status | Details |
| --- | --- | --- | --- | --- |
| Approved Phase 3 authorities | `src/package-produce.js` | exact artifact admission | WIRED | Actual fixture package was materialized and archive closure recomputed. |
| `src/package-produce.js` | `src/targets/openclaw-package.js` | target-neutral resources to installable projection | WIRED | 40 real members, including workspace, skill, hook plugin, policies, evals, and proposals. |
| `src/cli.js` | `src/package-inspect.js` | offline human/JSON inspection | WIRED | Directory/archive semantic parity is verified. |
| `src/cli.js` | `src/openclaw-probe.js` | durable read-only probe command | WIRED BUT UNSAFE | Command exists and fixture passes; retained executable authority is lost before spawn. |
| `src/cli.js` | `src/openclaw-install-transaction.js` | public apply command | WIRED BUT UNSAFE | CLI omits `adapters`; transaction therefore reuses the old probe and cannot run sensitive actions. |
| `src/openclaw-install-transaction.js` | fresh OpenClaw observation | `reprobe()` | NOT WIRED | Missing adapter returns `basis.probe`; no new observation occurs. |
| `src/openclaw-install-transaction.js` | managed paths | observation/write/recovery | UNSAFE | Lexical containment and pathname effects do not retain the ancestor chain or deletion identity. |
| `src/openclaw-install-transaction.js` | `src/openclaw-install-receipt.js` | post-observe, receipt-last | PARTIAL | Receipt is last on the happy path, but it can be false-complete and drops external results/authority. |
| `src/openclaw-install-transaction.js` | `src/openclaw-credential-handoff.js` | official sensitive-action route | NOT WIRED | No production adapter/dispatcher connects them. |

### Data-Flow Trace (Level 4)

| Artifact | Data | Source | Produces real data | Status |
| --- | --- | --- | --- | --- |
| Agent Package | 40 manifest members and file bytes | Exact approved blueprint/build-contract/plan/target-carrier artifacts | Yes | FLOWING |
| Offline inspection | Digests, carriers, permissions, sensitive actions, operations, risks | Directory or D-42 archive closure | Yes, identical for both inputs | FLOWING |
| Probe artifact | Target/CLI/surface facts | Approved target files plus three child commands | Fixture facts exist, but executable identity is not retained through spawn | UNSAFE |
| Install plan/review | Managed operations, patches, conflicts, action decisions | Archive, probe, lifecycle request, genesis/receipt | Real deterministic models | FLOWING TO INCOMPLETE EFFECT SEAM |
| Install receipt | Managed outcomes and external effects | Post-observation plus `externalResults` | Managed outcomes only; external results and authority are discarded | HOLLOW EVIDENCE |
| Credential result | Official-route bounded result | Proposal + decision + runner | Runner is caller-supplied, accepts arbitrary OpenClaw argv, and is not production-wired | DISCONNECTED/UNSAFE |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| --- | --- | --- | --- |
| Deterministic package/archive | `node --test --test-name-pattern='builds byte-identical directories and archives under different roots' test/package-determinism.test.js` | 1/1 pass | PASS |
| Actual checked-in archive rebuild | `buildPackageArchive` + exact byte comparison against `04-03-agent-package.d42` | Byte-identical; 40 members; archive `sha256:7726d7...55f` | PASS |
| Offline inspection parity | Named `returns one frozen value-blind candidate...` test and direct directory/archive comparison | 1/1 pass; candidates identical | PASS |
| Bounded fixture probe | Named `binds the exact archive and target authority without touching operator state` test | 1/1 pass | PASS (fixture mechanism only) |
| Bounded support-triage composition | Named Phase 4 Wave 10 contract test | 1/1 pass | PASS (does not certify safe apply) |
| Happy-path disposable install | Named receipt-last transaction test | 1/1 pass; create-write receipt produced | PASS (bounded happy path only) |
| Credential command restriction | In-memory proposal/decision with argv `plugins install evil` and fake runner | Accepted; `credentialPresent: true` | FAIL |
| Complete receipt semantics | Mutated public minimal receipt to `outcome: preserved` plus one `preservedAsset`, kept status `complete` | `validateOpenClawInstallReceipt(...).ok === true` | FAIL |

The full `npm run check` result supplied with the phase was not treated as goal evidence and was not rerun. Verification used single named tests and read-only/in-memory reproductions; no server, real OpenClaw lifecycle, network, credential, `.env`, or external state was used.

### Probe Execution

No phase-declared `scripts/*/tests/probe-*.sh` exists. The JavaScript OpenClaw capability probe’s single named fixture test passed, but the source-level production-admission and pathname-execution gaps remain. No real OpenClaw probe or target mutation was run.

### Requirements Coverage

| Requirement | Status | Evidence |
| --- | --- | --- |
| PACK-01 | SATISFIED | Versioned `agentmo.package.json` contains package identity/version, source bindings, target compatibility, capabilities, inventory, ownership, permissions, evidence refs, boundary, and risks. |
| PACK-02 | SATISFIED | Actual offline candidate exposes prompts/skills/tools/hooks/memory/evals/mappings/permissions/evidence/boundary/risks. |
| PACK-03 | SATISFIED | Named determinism test passes and checked-in archive rebuild is byte-identical. |
| PACK-04 | SATISFIED | Actual package uses workspace-content/skill by default and native plugin only for approved typed hooks, with necessity/trust fields and no MCP surface. |
| PACK-05 | SATISFIED | Directory/archive inspect is read-only and hostile private-material tests exist; actual package contains value-blind proposals/policies, not secret/auth/session/database/transcript payloads. |
| OCLW-01 | BLOCKED | Probe coverage exists, but pathname execution and missing production fresh reprobe make the exact current target observation untrustworthy. |
| OCLW-02 | BLOCKED | Models bind plan content, but apply can reuse an old probe/approval and does not reliably invalidate all current target/ownership drift. |
| OCLW-03 | BLOCKED | Receipt omits external dependencies/effect results and exact approval authority, and false-complete receipts validate. |
| OCLW-04 | BLOCKED | Lexical path effects and cached-predicate recovery can escape/delete replacements; patch/remove/upgrade/rollback/uninstall effects are not implemented. |
| OCLW-05 | BLOCKED | Package resources are separated, but minimal config patches and credential/session actions are not implemented through a complete safe production seam. |
| EVID-05 | BLOCKED | Inspection displays the required fields, but sensitive approvals are replayable and credential exact-action routing fails closed only against a weak blacklist. |

**Requirements score:** 5/11 satisfied. All 11 Phase 4 requirements appear in plan frontmatter; no orphaned requirement ID was found.

### Code Review Finding Adjudication

The prior review narrative was not accepted as evidence. Each item below was rechecked against the current source; the two most direct authority defects were also reproduced independently.

| ID | Severity | Adjudication | Current-code evidence |
| --- | --- | --- | --- |
| CR-01 | BLOCKER | CONFIRMED | `src/cli.js:1265` calls apply without adapters; `src/openclaw-install-transaction.js:588` returns the old probe when reprobe is absent. |
| CR-02 | BLOCKER | CONFIRMED | Apply parses carrier/probe bytes without companion-backed carrier admission; optional field checks at transaction lines 577–585 allow omission, while probe validation proves only self-consistency. |
| CR-03 | BLOCKER | CONFIRMED | `resolveManagedPath` is lexical; observation checks only the immediate parent and `writeFile(target, ...)` follows ancestor symlinks. |
| CR-04 | BLOCKER | CONFIRMED | Attempt results are WeakSet-tagged with cached true predicates; recovery then unlinks the pathname without a coupled final re-observation. |
| CR-05 | BLOCKER | CONFIRMED | Apply creates `usedNonces: []` on every invocation; no durable nonce ledger/receipt field exists. |
| CR-06 | BLOCKER | CONFIRMED | Safe reproduction accepted `openclaw plugins install evil` as credential setup. |
| CR-07 | BLOCKER | CONFIRMED | Safe reproduction showed a complete receipt with a preserved outcome/asset validates successfully. |
| CR-08 | BLOCKER | CONFIRMED | Receipt key set omits plan/approval/nonce/action evidence; `externalResults` is collected and passed but absent from `buildReceipt` parameters/output. |
| CR-09 | BLOCKER | CONFIRMED | Probe closes the no-follow target-member handle, then spawns its pathname; `spawn` has no `cwd`. |
| CR-10 | BLOCKER | CONFIRMED | Package/authority publishers remove final pathnames after failure without comparing retained published identities. |
| WR-01 | WARNING | CONFIRMED | Apply advertises four lifecycles but implements only absent-file write creation; patch/remove are preserved as unsupported, and sensitive actions lack a public runner. |
| WR-02 | WARNING | CONFIRMED | `buildOpenClawAbsentGenesisAuthority` sets `verifiedAbsent: true` from caller fields and a caller-supplied digest. |
| WR-03 | WARNING | CONFIRMED | OpenClaw plugin projection uses `path.posix.basename(file.relativePath)`, flattening nested approved recipe paths. |

### Anti-Patterns Found

No unreferenced `TBD`, `FIXME`, or `XXX` marker was found in the Phase 4 implementation/test surface. The observed `return null` sites are bounded helper outcomes, not UI/API stubs.

The blocker anti-pattern is semantic: security-critical functions exist and are wired enough to pass happy-path tests, but their authority/effect invariants are hollow on adversarial paths.

### Human Verification Required

None is currently actionable. A real OpenClaw install would mutate target state and cannot repair or disprove the code-level blockers. The earlier Plan 04-02 exact-target checkpoint has a concrete selected artifact whose raw digest was independently recomputed during this verification; no new target approval was attempted.

### Deferred Items

No blocker is deferred. Phase 5 owns real isolated runtime/lifecycle evidence after a safe mechanism exists; it does not own repair of Phase 4’s missing fresh probe, approval consumption, path safety, receipt completeness, credential routing, or lifecycle effect implementation. Using Phase 5 to “test through” these defects would violate the phase boundary.

### Gaps Summary

The package half of the goal is achieved: exact approved inputs produce a deterministic 40-member package, the D-42 archive is reproducible, and offline inspection is complete and value-blind. The installation half is not.

Six root concerns block progression:

1. The public apply route does not perform a mandatory, trustworthy fresh probe.
2. Approval nonces are replayable and credential action authority is not exact.
3. Managed writes and recovery are pathname-race/symlink unsafe.
4. Receipt semantics can report false completion and omit external effect authority/results.
5. The advertised four lifecycle/config/credential mechanisms are not implemented through the production seam.
6. Create-only package/authority publication cleanup can delete a replacement pathname.

**Next action:** Repair these mechanisms with fail-first adversarial tests, rerun code review, then re-verify Phase 4 before any Phase 5 real-target work.

**Next command:** `/gsd:plan-phase 04 --gaps`

---

_Verified: 2026-07-30T05:26:08Z_
_Verifier: the agent (gsd-verifier)_
