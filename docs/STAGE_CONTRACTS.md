# AgentMo Stage Contracts

AgentMo stages are connected by artifact contracts, not by mandatory command ancestry. A stage may require a valid prior artifact, but it must not require that artifact to have been produced by the previous AgentMo command in the same workspace.

```text
Stage 1 Discover -> Discovery Contract
Stage 2 Plan     -> Agent Design / Blueprint Contract
Stage 3 Produce  -> Delivery Evidence Contract
```

The support-triage MVP remains the composed vertical demo of these contracts. It is not the only valid path through AgentMo.

## Contract matrix

| Stage | Purpose | Accepted inputs | Produced outputs | Forbidden process dependency |
| --- | --- | --- | --- | --- |
| Stage 1 Discover | Materialize bounded source inventory, sanitized facts, and coverage; optionally express a proposal-only Agent Idea Candidate for human review. | `agentmo.discovery.v1` manifest. `discover-pack` is manifest-only; `discover-workspace` reads approved repo-local files; `discover-live` reads only exact allowlisted public HTTPS sources through closed adapters. | `agentmo.discovery-db.v1`, `facts.jsonl`, `coverage.json`; workspace/live intake also writes `source-cards.json` and `source-chunks.jsonl`; live intake adds `retrievals.jsonl`. A separately authored `agentmo.agent-idea-candidate.v1` may exact-bind the DB as a proposal. | Stage 2 planner implementation, human decision authority, blueprint files, Stage 3 runtime target or run evidence. |
| Stage 2 Plan | Convert explicitly approved discovery facts plus user need and typed decisions into an auditable plan and complete build contract. | Exact `agentmo.discovery.v1`, `agentmo.discovery-db.v1`, `agentmo.discovery-approval.v1`, `agentmo.user-need.v1`, and current `agentmo.decision-ledger.v1` artifacts. | `agentmo.design-plan.v1`, draft blueprint, `agentmo.build-contract.v1`, and exact `agentmo.plan-approval.v1`. | Stage 1 command ancestry, raw sidecars, Phase 4 generation/install, Phase 5 runtime/recovery proof. |
| Stage 3 Produce | Turn an exact-approved build contract or separately admitted externally reviewed design into package and delivery work. | Exact blueprint/build-contract approval for the AgentMo lane, or independently valid externally reviewed/business-provided design with bounded provenance. | Roadmap Phase 4 generates/installs; Phase 5 executes and produces runtime, recovery, eval, birth, and delivery evidence. | Discovery command ancestry, hidden session authority, or treating approval as quality/runtime certification. |

Roadmap Phase 3 specifies and approves the exact build contract. Phase 4 generates the package and performs separately authorized installation/loading. Phase 5 executes and proves isolated runtime and recovery behavior. These ownership boundaries do not change the legacy three-stage vocabulary above.

## Phase 4 Produce package and lifecycle contract

Phase 4 is the bounded package/install portion of Produce. It does not run an
agent or establish Birth/Delivery evidence.

The deterministic canonical package directory is build authority. It contains
the target-neutral `agentmo.package.json`, the complete resource inventory, and
the OpenClaw projection. The directory may be inspected with its exact manifest
digest, but it is never an install transport. `package-produce` deterministically
encodes the same member closure as a D-42 archive. Every downstream probe,
preview, approval, and apply authority binds that archive by:

- caller-supplied external archive SHA-256;
- internal package-manifest SHA-256;
- canonical inventory SHA-256; and
- the complete sorted member closure of portable path, regular-file type,
  fixed mode, byte length, and member SHA-256.

Extra, missing, reordered, type-drifted, mode-drifted, content-drifted, or
identity-swapped archive members fail closed. Probe and apply retain no-follow
regular-file reads and revalidate identity before any target effect. A package
root or standalone manifest cannot substitute for the D-42 transport.

The public Phase 4 sequence is:

```text
openclaw-fs-kernel-build
  -> openclaw-target-describe -> openclaw-target-admit
  -> package-produce -> package-inspect -> openclaw-probe
  -> openclaw-install-genesis
  -> openclaw-install-preview
  -> openclaw-install-approve
  -> openclaw-install-apply
```

The helper is an explicitly built and admitted local mechanism. The published
npm tarball contains the repository-owned C source and JavaScript facade only,
not a host-built helper, helper receipt, authority state, or install-time
compiler hook. Every current public publisher and lifecycle mutation requires
the exact helper path, durable closed build receipt, and caller-supplied
external receipt digest. The receipt rebinds source/compiler/toolchain, fixed
argv, closed environment descriptor, binary bytes, mode, and retained
identities. No auto-build, PATH lookup, downloaded binary, prebuilt binary, or
JavaScript mutation fallback exists.

`package-produce` re-admits the exact blueprint, design plan, discovery
approval, decision-ledger head, recipe-bearing build contract, plan approval,
target descriptor, and target/carrier admission. The selected Phase 4 package
binds OpenClaw `2026.7.1-2@0790d9f`; a differently observed target is not valid
under that approval and must return to descriptor, contract, plan approval, and
target/carrier admission. No install approval can repair a target mismatch.

`openclaw-probe` is a bounded, read-only compatibility observation over the
exact archive and exact target/carrier authority. Fixed `shell:false` capability
observations run only in a disposable synthetic HOME/state/config/workspace.
The normalized fingerprint does not prove plugin load, MCP connection,
credential use, agent invocation, schedule execution, or live compatibility.
The selected package has no MCP carrier or MCP install route.

Lifecycle review has exactly three non-interchangeable authority families:

1. one ordinary approval for managed writes;
2. one decision for each exact sensitive action, binding executable, argv, cwd,
   scope, target, timeout, and environment-name set; and
3. one approval for the entire exact conflict set, binding every path, current
   digest, desired digest, and action.

Changing any plan, target fingerprint, archive/member byte, action, conflict,
scope, or predecessor invalidates the relevant authority. The one-screen human
and JSON review views are renderings of the same frozen semantic model; ordinary
approval cannot grant sensitive-action or conflict authority.

The four lifecycle mechanisms have closed predecessor bases:

| Lifecycle | Required exact basis |
| --- | --- |
| install | one verified absent-genesis authority |
| upgrade | one current install receipt |
| explicit rollback | current receipt plus the selected predecessor receipt and selected predecessor D-42 archive |
| uninstall | one current install receipt |

Explicit rollback is an operator-selected successor and is distinct from
automatic failure recovery. Apply re-admits every authority from a
caller-selected file plus external SHA-256, immediately re-probes target and
ownership state, writes a synced private attempt journal, performs only approved
effects, post-observes every path, and publishes a create-only complete or
incomplete receipt last. A complete receipt is not inferred from a plan,
approval, journal, or partial observation.

There is no public authority/evidence-root option. The canonical ledger is
derived internally from the real OpenClaw target root and exact target
descriptor and then reopened through retained authority. Before any marker,
private journal, official action, or managed effect, `useNonce` must be globally
unique across ordinary, every sensitive, and conflict authority. Each family is
then consumed by a durable final marker; all three marker families are reopened
canonically before effect or resume. The retained-dirfd kernel reserves the
final name create-exclusively before writing canonical bytes. Zero, partial,
stale, or unknown markers remain permanently fail-closed. Only the complete
marker set and byte-exact journal for the same exact attempt can resume in a
fresh process; there is no caller-supplied root or `usedNonces` authority.

A strict complete receipt is an exact authority/result theorem: every managed
operation and supported sensitive/external action has one unique successful
result, all three approval families and nonces are consumed exactly, post-state
matches, and preservation/recovery sets are empty. The producer publishes three
additional authority classes inside the canonical ledger: retained-session
post-state, one ordered official-action-result record per action, and one
append-only finalization. Receipt admission reopens those exact records and
recomputes receipt fields from them. Current and rollback predecessor receipts
are recursively admitted through the same producer-auth evidence plus their
exact plan, approvals, ordered sensitive decisions, journal, probe, package
manifest, target/carrier admission, blueprint, build contract, plan approval,
and target descriptor. Preview and apply transport a non-install chain only
through an exact external-digest-bound, bounded/no-follow companion bundle;
the request bundle is not installed or persisted as package authority, and
its file bindings must be portable relative references confined to the bundle
parent (absolute and traversal-shaped references fail before evidence intake).
Structural receipt validity or generic JSON plus a
caller-recomputed digest is not current or historical authority.

Unknown, modified, externally owned, identity-drifted, or ownership-ambiguous
assets are preserved. Recovery reopens every named object through a fresh
retained-dirfd session. Published objects are not deleted from a reopened
pathname even when marker, identity, and digest still match; exact matches and
all failed predicates remain explicit preservation/recovery work in an
incomplete receipt.

File/directory publication is temp-complete and source-consuming through the
retained-dirfd native kernel: Linux uses
`renameat2(..., RENAME_NOREPLACE)` and Darwin uses
`renameatx_np(..., RENAME_EXCL)`. Private prepublication objects and visible
postpublication objects are distinct preserved evidence classes. There is no
plain-rename, hard-link, pathname cleanup, recursive delete, or replacement
fallback. Package success rechecks the complete nested directory/archive
closure before and after publication. Every known private temp is represented
as exact, mismatched, or unknown recovery work. Helper binary/receipt failures
likewise return a recoverable pair record rather than an unitemized orphan.
Unsupported platforms and filesystem semantics fail closed.

Install, upgrade, explicit rollback, and uninstall have bounded Linux-focused
fixtures, not cross-platform lifecycle certification. Genesis derives absence
from two retained observations of plan-derived paths. On Linux, configuration
mutation gives the verified child only a retained private candidate through
`/proc/self/fd`, requires dry-run/actual process-group quiescence, and publishes
the final target only through identity-bound native `replaceExact`. Darwin has
no final-path fallback and returns an explicit unsupported result, so Phase 4
does not claim all four lifecycles complete on macOS.

The closed `secrets apply` / `models auth login` argv grammar is proposal-only.
Phase 4 credential execution is unsupported, starts no process, and records
`credentialPresent:false`; it cannot be counted as a successful external
result. Unknown commands, MCP, plugin installation, agent/schedule/restart
actions, credential values, raw output, auth/session state, and
credential-bearing OpenClaw state are unsupported.

Official config processes are supervised on Linux by a native subreaper/pidfd
boundary. A bidirectional pre-exec handshake withholds target execution until
direct pidfd and clock admission succeed. The inherited seccomp lock rejects
x32 on x86_64 and denies `setsid`, `setpgid`, outbound signal syscalls,
`pidfd_send_signal`, and `ptrace`; the supervisor is non-dumpable and recycles
terminal pidfd slots. `/proc` enumeration plus the original process group drive
bounded TERM/KILL settlement. Non-Linux platforms reject before spawn. The
exact `7c902af59b5705de5ca31e83561adeaaeeed130f` candidate passed the bounded
Ubuntu 24.04 / Node 20.20.2 native containment and credential job in GitHub
Actions run `30781382363`; that job is not a general OS sandbox proof, full
project gate, canonical Phase 4 verdict, or production certification.

Phase 4 evidence proves deterministic package, exact admission, bounded probe,
approval, preservation, transaction, and receipt mechanisms only. Real
OpenClaw install/upgrade/rollback/uninstall execution, plugin activation, agent
or schedule execution, restart recovery, memory/RAG behavior, credential login,
domain evaluation, `live-success`, Birth, Delivery, production readiness, and
wider OpenClaw compatibility remain absent and Phase 5-owned.

The first settled 2026-08-02 source reached main 956 pass / 0 fail / 7 skip,
packed hook 1/1, packed behavior 8/8, and a 103-entry npm dry-run. The subsequent
fresh re-audit found a supervisor capacity/pidfd-admission gap. The current
worktree subsequently added slot recycling and the inherited group lock. A
third re-audit found supervisor-signal, bootstrap-failure, and x32 gaps; current
source adds signal/ptrace denial, the pre-exec handshake, x32 rejection, and
Linux-only regressions. Its exact-candidate Linux native job is recorded
separately in `release/2026.08.03.md`; the full-project successor and later
fresh-audit gates must still be recorded separately. The package must continue to
exclude runtime evidence instances, compiled helpers, helper receipts,
authority state, and install hooks.

## Stage 1 Discover -> Discovery Contract

### Ownership

Stage 1 owns source inventory, sanitized fact extraction, coverage, and discovery safety metadata. It does not decide the agent architecture or runtime target.

### Accepted input artifacts

- Current CLI input: `agentmo.discovery.v1` discovery manifest.
- `discover-workspace` additionally requires an explicit `--source-root <dir>` that resolves inside the current AgentMo repository root.
- Future/external collector input is acceptable only when it can produce the same sanitized discovery contract artifacts.

### Produced output artifacts

`agentmo discover-pack` is the manifest-only path. It emits an `agentmo.discovery-pack.v1` summary and writes:

- `agentmo-discovery-db.json` with `schemaVersion: "agentmo.discovery-db.v1"`;
- `facts.jsonl` with bounded sanitized fact records;
- `coverage.json` with source/fact/output coverage metadata.

`agentmo discover-workspace <discovery.json> --source-root <dir> --out <dir> [--json]` is the approved local source-intake path. It writes the same durable discovery DB plus workspace sidecars:

- `agentmo-discovery-db.json` with `schemaVersion: "agentmo.discovery-db.v1"`;
- `facts.jsonl` emitted from the same facts array as the DB;
- `coverage.json` with source, chunk, rejection, redaction, and truncation coverage;
- `source-cards.json` with sanitized per-source metadata/previews;
- `source-chunks.jsonl` with bounded sanitized chunk records.

Source-derived evidence must be DB-visible as `kind:"source_chunk"` facts in both `agentmo-discovery-db.json.facts` and `facts.jsonl`. `source-cards.json` and `source-chunks.jsonl` are supplemental; they are not required Stage 2 inputs.

### Validators and commands

- `agentmo artifact-contract discovery-manifest --json`
- `agentmo artifact-contract agent-idea-candidate --json`
- `agentmo agent-idea-candidate-report <candidate.json> --discovery-db <db.json> --digest agent-idea-candidate=<sha256:...> --digest discovery-db=<sha256:...> [--json]`
- `agentmo discover-report <discovery.json> [--json]`
- `agentmo discover-pack <discovery.json> --out <dir> [--json]`
- `agentmo discover-workspace <discovery.json> --source-root <dir> --out <dir> [--json]`
- `agentmo discover-live <discovery.json> --digest discovery-manifest=<sha256:...> --out <absent-dir> [--json]`
- Pure helpers: `validateDiscoveryManifest`, `buildDiscoveryPack`, `buildDiscoveryDb`.

`artifact-contract` exports a field-level JSON Schema and a minimal template that passes the current production validator. The Discover subcommands also support bounded `--help`. When exact-digest admission reaches a registered `agentmo.discovery.v1` identity but field validation fails, JSON error output includes only the canonical subject and bounded field requirement messages; input values and host paths remain undisclosed.

The target-neutral `agentmo.agent-idea-candidate.v1` contract is proposal-only. It records a candidate idea, target users/tasks, a value hypothesis, exact Discovery DB provenance, evidence IDs, evidence gaps, judgment boundaries, and a fixed non-certification boundary. Each evidence ID must resolve uniquely to one exact admitted DB fact; the schema does not require a domain-specific fact kind. `extraction_field` facts may be cited only as planning leads and produce a bounded insufficiency warning. The report is read-only and discloses only bounded composition metadata.

The Candidate has no `humanDecision`, approval state, enter-Plan permission, build/runtime authority, or organization-authentication claim. It cannot certify user need, value, capability, domain quality, Plan readiness, production readiness, or any downstream authority. No Stage 2 command accepts it in this release. A future Decision Artifact, outside this contract, must exact-bind its digest before recording a human decision.

### Forbidden reads and dependencies

Stage 1 must not require:

- `agentmo.user-need.v1`;
- a blueprint/design contract;
- `blueprint-draft`, `handoff`, `scaffold`, `run`, `birth-report`, `domain-eval`, or `delivery-report` execution;
- blueprint, handoff, build-state, run-state, birth-report, domain-eval, or delivery-report artifact writes;
- a runtime target such as `openclaw`;
- generic web crawling, browser automation, open search, caller-selected adapters, or any network location outside the exact manifest allowlist;
- source roots that point at parent directories, sibling projects, `.env` files, credential files, key/cert directories, or other secret roots.

Contract export and `discover-pack` are not collection evidence. `discover-live` can fetch exact allowlisted HTTPS sources within count/byte/time/redirect/content-type bounds. Its closed `source_inventory[].evidence_class` distinguishes `primary`, `first-party`, `context`, and `community` independently from trust/confidence; Web and GitHub preserve the explicit role, while arXiv rejects non-primary classification and enforces a 3000 ms minimum request-start interval inside the aggregate deadline. The resulting body digest, evidence class, and sanitized record do not certify content truth, semantic quality, freshness, license, domain quality, runtime, or production readiness.

### Guarantees and safety boundaries

- Discovery outputs are sanitized managed artifacts.
- Safety metadata keeps `rawSecretsStored:false`, `rawTranscriptsStored:false`, and `rawToolBodiesStored:false`.
- `discover-workspace` must fail closed when a workspace is unsafe. The emitted DB must expose that state through validation/safety fields such as `validation.ok:false` or `safety.workspaceOk:false`.
- Stage 1 does not claim generic crawling, browser automation, or open search. Live records must enter through the closed bounded collector contract and never persist raw provider bodies or credentials.

### Certification boundary

A valid Discovery Contract proves only that discovery artifacts were materialized and sanitized. It does not certify an agent design, runtime behavior, domain-wide quality, or production readiness.

### Independent verification command

```bash
WORK=/tmp/agentmo-stage-contracts
rm -rf "$WORK"
mkdir -p "$WORK"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
node ./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out "$WORK/discovery-workspace" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

## Stage 2 Plan -> Agent Design / Blueprint Contract

### Ownership

Stage 2 owns user-need interpretation, the `agentmo.design-plan.v1` planning contract, blueprint drafting, agent architecture, eval/rubric requirements, evidence policy, the complete `agentmo.build-contract.v1`, and exact plan approval. Generated blueprint state is draft and non-authoritative; only a separate exact `agentmo.plan-approval.v1` records local intent to enter Produce. Stage 2 does not generate or install the package.

### Accepted input artifacts

- `agentmo-discovery-db.json` with `schemaVersion: "agentmo.discovery-db.v1"`.
- User need JSON with `schemaVersion: "agentmo.user-need.v1"`.
- Current predecessor-bound decision ledger with `schemaVersion: "agentmo.decision-ledger.v1"`.

The discovery DB may come from `discover-pack`, `discover-workspace`, an imported database, or a manual/external process. Stage 2 depends on exact raw-byte admission of the manifest, database, approval, and user need—not on Stage 1 command ancestry. The approval binds only the exact manifest/database digests and proves local enter-Plan intent; it does not authenticate an organization or certify source quality. A workspace DB with failing validation or `safety.workspaceOk:false` is not a valid Stage 2 input.

### Produced output artifacts

Stage 2 produces a valid `agentmo.design-plan.v1` plus a valid AgentMo blueprint/design contract:

- `agentmo.design-plan.v1` records requirements trace, evidence map, gaps, architecture plan, tool contract plan, eval plan, evidence policy, governance gates, and certification boundary;

- `agentmo_version: "0.1"`;
- explicit `agent_id`, `runtime`, and target/runtime profile information where applicable;
- `domain_genome`, `architecture`, `tools`, `eval`, `evidence`, `governance`, and `release.known_risks`;
- evidence audit rules that forbid credential values, raw transcripts, raw tool bodies, raw stdout/stderr previews, and production runtime state in managed evidence;
- eval requirements, including required case classes and hard-failure expectations.
- `agentmo.build-contract.v1`, binding the exact blueprint, design plan, discovery approval, and decision-ledger head while projecting all 22 OpenClaw resource families;
- `agentmo.plan-approval.v1`, separately binding the exact blueprint/build-contract bytes with `decisionScope:"enter-produce"`.

### Validators and commands

- `agentmo need-report <need.json> [--json]`
- `agentmo decision-ledger canonicalize-entry ...` creates a new absent canonical Decision Entry artifact before its digest exists, fixing reference-array order before serializing and verifying its one-link private-stage bytes. It requires a caller-owned non-group/world-writable output parent and exclusive same-UID control of its output parent, private stage, and target namespace; it is not a concurrent same-UID filesystem transaction. Observable pre-publication identity or symlink anomalies fail closed, and it never rolls back a published public pathname. `append|inspect` records or inspects typed, predecessor-bound Plan decisions and never rewrites approved bytes, accepts transcripts, or accepts stdin authority.
- `agentmo artifact-contract decision-entry --json` exports the closed five-kind entry schema, byte-sorted unique reference-array rule, and a production-validator-valid minimal template.
- `agentmo design-plan <agentmo-discovery-db.json> --manifest <discovery.json> --discovery-approval <approval.json> --need <need.json> --decision-ledger <ledger.json> --digest discovery-manifest=<sha256:...> --digest discovery-db=<sha256:...> --digest discovery-approval=<sha256:...> --digest user-need=<sha256:...> --digest decision-ledger=<sha256:...> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]`
- `agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --design-plan <agentmo-design-plan.json> --out <blueprint.json> [--target agentmo|openclaw] [--json]`
- `agentmo validate <blueprint.json>`
- `agentmo openclaw-fs-kernel-build --binary-out <absent-private-helper> --receipt-out <absent-private-receipt> [--json]`
- `agentmo openclaw-target-describe --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest target-executable=<sha256:...> --digest target-package-json=<sha256:...> --digest target-build-info=<sha256:...> --fs-helper <helper> --fs-helper-receipt <helper-receipt> --fs-helper-receipt-digest <sha256:...> --out <descriptor.json> [--json]`
- `agentmo build-contract <blueprint.json> --design-plan <plan.json> --discovery-approval <approval.json> --decision-ledger <ledger.json> --target-descriptor <descriptor.json> --digest blueprint=<sha256:...> --digest design-plan=<sha256:...> --digest discovery-approval=<sha256:...> --digest decision-ledger=<sha256:...> --digest openclaw-target-descriptor=<sha256:...> --out <contract.json> --target openclaw [--json]`
- `agentmo plan-approve <blueprint.json> --build-contract <contract.json> --digest blueprint=<sha256:...> --digest build-contract=<sha256:...> [--approve --preview-digest <sha256:...> --out <approval.json>] [--json]`
- `agentmo openclaw-target-admit <blueprint.json> --build-contract <contract.json> --plan-approval <approval.json> --target-descriptor <descriptor.json> --target-executable <file> --target-package-json <package.json> --target-build-info <build-info.json> --digest blueprint=<sha256:...> --digest build-contract=<sha256:...> --digest plan-approval=<sha256:...> --digest openclaw-target-descriptor=<sha256:...> --digest target-executable=<sha256:...> --digest target-package-json=<sha256:...> --digest target-build-info=<sha256:...> --fs-helper <helper> --fs-helper-receipt <helper-receipt> --fs-helper-receipt-digest <sha256:...> --out <admission.json> [--json]`
- Pure helpers: `validateUserNeed`, `loadDiscoveryDb`, `buildDesignPlan`, `validateDesignPlan`, `draftBlueprint`, `validateBlueprint`.

### Forbidden reads and dependencies

Stage 2 must not require:

- the original `agentmo.discovery.v1` manifest when a valid `agentmo.discovery-db.v1` is supplied;
- `discover-pack` or `discover-workspace` execution in the same command path;
- workspace sidecars such as `source-cards.json` or `source-chunks.jsonl` when the discovery DB already contains valid `source_chunk` facts;
- `agentmo.agent-idea-candidate.v1` as user need, discovery approval, decision-ledger authority, or implicit permission to enter Plan;
- Stage 3 handoff/scaffold/run/birth/delivery artifacts.

### Guarantees and safety boundaries

- The blueprint validates before Stage 3 admission.
- Unsafe workspace DBs fail closed before design-plan or blueprint drafting.
- Per D-13, `design-plan` hashes the single captured raw `Buffer` for each input before UTF-8 decode, duplicate-member inspection, JSON parse, content audit, identity lookup, or schema validation.
- `source_refs` fail closed on absolute paths, parent traversal, `.env`/key/cert/token-like refs, URL credentials, and non-http(s) schemes.
- The design-plan describes trace/gaps/eval/governance before blueprint claims.
- Manifest-only `extraction_field` facts are declarations and can never produce `supported` coverage. They remain `partial` when matched. `supported` requires at least two matching source-derived `source_chunk` facts with `derived`, `trusted`, or `verified` trust; unverified chunks remain `partial`.
- A drafted blueprint is still a non-authoritative plan. Plan approval is explicit local operator intent, not authenticated organizational identity, installation authority, runtime evidence, domain quality, or production approval.
- Manifest-only `extraction_field` declarations and mechanical dedup/freshness/conflict/coverage observations remain below semantic proof.

### Certification boundary

A matching digest proves only that the supplied raw bytes are the bytes admitted under the named schema contract. A valid build contract plus plan approval authorizes entry to Produce only. Neither collection, blueprint, contract, approval, `declared-ready`, nor bounded live smoke proves authenticated organizational identity, source/package quality, runtime execution, domain-wide quality, production deployment, or customer approval.

### Independent verification command

Use any prebuilt valid discovery DB; this command does not invoke `discover-pack`:

```bash
DISCOVERY_DB=/path/to/agentmo-discovery-db.json
DISCOVERY_MANIFEST=/path/to/discovery.json
USER_NEED=examples/support-triage.need.json
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
PREVIEW_DIGEST=$(node ./bin/agentmo.js discovery-approve "$DISCOVERY_MANIFEST" --discovery-db "$DISCOVERY_DB" --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")" --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" --json | node -e 'let s="";process.stdin.on("data",c=>s+=c).on("end",()=>process.stdout.write(JSON.parse(s).previewDigest));')
node ./bin/agentmo.js discovery-approve "$DISCOVERY_MANIFEST" --discovery-db "$DISCOVERY_DB" \
  --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --approve --preview-digest "$PREVIEW_DIGEST" \
  --out /tmp/support-triage-discovery-approval.json --json
node ./bin/agentmo.js decision-ledger append --journal /tmp/support-triage-decision-ledger.json \
  --entry examples/support-triage.decision-entry.json \
  --digest "decision-entry=$(digest_file "examples/support-triage.decision-entry.json")" --json
node ./bin/agentmo.js design-plan "$DISCOVERY_DB" \
  --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "discovery-approval=$(digest_file "/tmp/support-triage-discovery-approval.json")" \
  --digest "user-need=$(digest_file "$USER_NEED")" \
  --digest "decision-ledger=$(digest_file "/tmp/support-triage-decision-ledger.json")" \
  --manifest "$DISCOVERY_MANIFEST" \
  --discovery-approval /tmp/support-triage-discovery-approval.json \
  --need "$USER_NEED" \
  --decision-ledger /tmp/support-triage-decision-ledger.json \
  --out /tmp/support-triage-design-plan.json \
  --target openclaw \
  --json
node ./bin/agentmo.js blueprint-draft "$DISCOVERY_DB" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "design-plan=$(digest_file "/tmp/support-triage-design-plan.json")" \
  --need examples/support-triage.need.json \
  --design-plan /tmp/support-triage-design-plan.json \
  --out /tmp/support-triage.agentmo.json \
  --target openclaw \
  --json
node ./bin/agentmo.js validate /tmp/support-triage.agentmo.json --digest "blueprint=$(digest_file "/tmp/support-triage.agentmo.json")"
```

## Stage 3 Produce -> Delivery Evidence Contract

### Ownership

Stage 3 owns coding/runtime handoff, scaffold/build state, run-state evidence, run evaluation, fail-closed birth reporting, bounded domain evaluation, and delivery evidence aggregation.

### Accepted input artifacts

- Valid AgentMo blueprint/design contract with `agentmo_version: "0.1"`.
- Explicit target/runtime options required by the chosen command.
- Optional bounded provenance for Stage 3 admission:
  - `source`: `agentmo-stage2` or `external-reviewed`;
  - `reviewed`: boolean;
  - `review_ref`: path or identifier for the review/source artifact when available;
  - `contract_version`: accepted AgentMo design contract version;
  - `notes`: bounded non-secret rationale.

Stage 3 may accept an externally reviewed or business-provided design contract when it validates and has bounded provenance. That provenance is an admission record, not a certification claim. If a handoff package names discovery pack or user-need artifacts, treat them as provenance/review references for AgentMo-generated designs, not as mandatory Stage 3 command ancestry for an externally reviewed design.

### Produced output artifacts

- Handoff package: `agentmo.handoff.v1` (`agentmo-handoff.json` plus docs).
- Build state: `agentmo.build.v1` (`agentmo-build-state.json`).
- Run state: `agentmo.run.v1` (`agentmo-run-state.json`) and run index `agentmo.run-index.v1` when `--out` is supplied.
- Run evaluation: `agentmo.run-eval.v1`.
- Birth report: `agentmo.birth-report.v1`.
- Domain evaluation: `agentmo.domain-eval.v1`.
- Delivery report: `agentmo.delivery.v1`.

### Validators and commands

- `agentmo validate <blueprint.json>`
- `agentmo handoff <blueprint.json> --target agentmo|openclaw --out <dir> [--json]`
- `agentmo scaffold <blueprint.json> --target agentmo|openclaw --out <dir>`
- `agentmo run-plan <blueprint.json> --digest blueprint=<exact-sha256> --target openclaw --workspace <dir> --message <text> [--json] > <runtime-plan.json>`
- `agentmo run <runtime-plan.json> --digest runtime-plan=<exact-sha256> --workspace <dir> --message <text> --out <dir> [--json]`
- `agentmo run-eval <run-state.json> --expect-status declared|success|failure [--json]`
- `agentmo birth-report <blueprint.json> --build-state <agentmo-build-state.json> --run-state <agentmo-run-state.json> --run-eval <run-eval.json> --expect-status declared|success|failure [--json]`
- `agentmo domain-eval <blueprint.json> --cases <cases.json> [--target agentmo|openclaw] [--json]`
- `agentmo delivery-report <blueprint.json> --build-state <agentmo-build-state.json> --run-state <agentmo-run-state.json> --run-eval <run-eval.json> --birth-report <birth-report.json> [--domain-eval <domain-eval.json>] [--json]`

`run` never consumes blueprint bytes directly: `run-plan` first emits the runtime-plan, then `run` admits those exact bytes. If the requested output already contains `agentmo-run-index.json`, the update must also supply `--digest run-index=<exact-sha256>` for that existing index; an unbound index is rejected rather than silently merged.

### Forbidden reads and dependencies

Stage 3 must not require:

- discovery DB files or user-need files when the blueprint/design contract is already valid;
- `discover-pack`, `need-report`, `design-plan`, or `blueprint-draft` execution in the same command path;
- raw provider payloads, raw transcripts, unrestricted tool bodies, or production runtime state in managed evidence.

### Guarantees and safety boundaries

- `handoff` validates the blueprint and records that handoff does not certify runtime or domain behavior.
- `scaffold` writes managed domain outputs plus `agentmo-build-state.json`; it does not run the target runtime.
- `run` defaults to declared/non-live evidence unless `--live` is explicit.
- `run-eval`, `birth-report`, and `delivery-report` fail closed on missing or mismatched evidence.
- `domain-eval` is bounded case-suite domain-quality evidence over supplied cases or reviewed eval artifacts.

### Certification boundary

Scaffold output, run-state evidence, run-eval, birth-report, domain-eval, and delivery-report do not certify runtime behavior, domain-wide quality, production readiness, or deployment approval by themselves. `declared-ready` proves wiring and deterministic mechanism evidence only. `live-success` proves isolated runtime execution only. A passing domain-eval proves only the supplied bounded case suite; production/domain-wide approval requires separate reviewed evidence and governance approval.

### Independent verification command

This starts Stage 3 from an existing valid blueprint and does not invoke Stage 1 or Stage 2 commands:

```bash
WORK=/tmp/agentmo-stage3-only
rm -rf "$WORK"
mkdir -p "$WORK"
BLUEPRINT=examples/support-triage.agentmo.json
RUNTIME_PLAN="$WORK/runtime-plan.json"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js validate "$BLUEPRINT" --digest "blueprint=$(digest_file "$BLUEPRINT")"
node ./bin/agentmo.js handoff "$BLUEPRINT" --target openclaw --out "$WORK/handoff" --json --digest "blueprint=$(digest_file "$BLUEPRINT")"
node ./bin/agentmo.js scaffold "$BLUEPRINT" --target openclaw --out "$WORK/scaffold" --digest "blueprint=$(digest_file "$BLUEPRINT")"
node ./bin/agentmo.js run-plan "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --target openclaw \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --json > "$RUNTIME_PLAN"
node ./bin/agentmo.js run "$RUNTIME_PLAN" \
  --digest "runtime-plan=$(digest_file "$RUNTIME_PLAN")" \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --out "$WORK/run" \
  --json > "$WORK/run-state.stdout.json"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json --digest "run-state=$(digest_file "$RUN_STATE")" > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json > "$WORK/birth-report.json"
node ./bin/agentmo.js domain-eval "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "domain-cases=$(digest_file "examples/support-triage.domain-cases.json")" \
  --cases examples/support-triage.domain-cases.json \
  --target openclaw \
  --json > "$WORK/domain-eval.json"
node ./bin/agentmo.js delivery-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --digest "birth-report=$(digest_file "$WORK/birth-report.json")" \
  --digest "domain-eval=$(digest_file "$WORK/domain-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --birth-report "$WORK/birth-report.json" \
  --domain-eval "$WORK/domain-eval.json" \
  --json > "$WORK/delivery-report.json"
```

## Composed vertical demo boundary

The support-triage MVP runs all three contracts in order:

```text
discover-pack|discover-workspace|discover-live -> discovery-approve -> need-report+decision-ledger -> design-plan -> blueprint-draft -> build-contract -> plan-approve -> Produce
```

That sequence proves the contracts compose. It does not make command ancestry mandatory for every valid AgentMo use case.
