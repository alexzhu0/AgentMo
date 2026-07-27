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
| Stage 1 Discover | Materialize bounded source inventory, sanitized facts, and coverage. | `agentmo.discovery.v1` manifest. `discover-pack` uses it as manifest-only input; `discover-workspace` also reads approved local source files under a repo-bound `--source-root`. | `agentmo.discovery-db.v1`, `facts.jsonl`, `coverage.json`; workspace intake also writes `source-cards.json` and `source-chunks.jsonl`. | Stage 2 planner implementation, blueprint files, Stage 3 runtime target or run evidence. |
| Stage 2 Plan | Convert valid discovery facts plus user need into an auditable plan and buildable agent design. | `agentmo.discovery-db.v1` plus `agentmo.user-need.v1`, regardless of how the discovery DB was created. | `agentmo.design-plan.v1` plus a valid AgentMo blueprint/design contract with `agentmo_version: "0.1"`, eval requirements, and evidence policy. | Stage 1 command path, original discovery manifest, Stage 3 scaffold/run/birth/delivery commands. |
| Stage 3 Produce | Turn a valid design contract into handoff, scaffold, run evidence, eval evidence, and delivery closure artifacts. | Valid blueprint/design contract and explicit target/runtime options. The design may be AgentMo-generated or externally reviewed/business-provided with bounded provenance. | `agentmo.handoff.v1`, `agentmo.build.v1`, `agentmo.run.v1`, `agentmo.run-eval.v1`, `agentmo.birth-report.v1`, `agentmo.domain-eval.v1`, `agentmo.delivery.v1`. | Discovery DB/user-need generation process, Stage 1 commands, Stage 2 commands. |

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
- `agentmo discover-report <discovery.json> [--json]`
- `agentmo discover-pack <discovery.json> --out <dir> [--json]`
- `agentmo discover-workspace <discovery.json> --source-root <dir> --out <dir> [--json]`
- Pure helpers: `validateDiscoveryManifest`, `buildDiscoveryPack`, `buildDiscoveryDb`.

`artifact-contract` exports a field-level JSON Schema and a minimal template that passes the current production validator. The Discover subcommands also support bounded `--help`. When exact-digest admission reaches a registered `agentmo.discovery.v1` identity but field validation fails, JSON error output includes only the canonical subject and bounded field requirement messages; input values and host paths remain undisclosed.

### Forbidden reads and dependencies

Stage 1 must not require:

- `agentmo.user-need.v1`;
- a blueprint/design contract;
- `blueprint-draft`, `handoff`, `scaffold`, `run`, `birth-report`, `domain-eval`, or `delivery-report` execution;
- blueprint, handoff, build-state, run-state, birth-report, domain-eval, or delivery-report artifact writes;
- a runtime target such as `openclaw`;
- web crawling, live search, browser automation, or search API access;
- source roots that point at parent directories, sibling projects, `.env` files, credential files, key/cert directories, or other secret roots.

Contract export is not collection evidence. A manifest may declare public URLs, but current Stage 1 does not fetch them or certify their content, freshness, license, safety, or availability.

### Guarantees and safety boundaries

- Discovery outputs are sanitized managed artifacts.
- Safety metadata keeps `rawSecretsStored:false`, `rawTranscriptsStored:false`, and `rawToolBodiesStored:false`.
- `discover-workspace` must fail closed when a workspace is unsafe. The emitted DB must expose that state through validation/safety fields such as `validation.ok:false` or `safety.workspaceOk:false`.
- Stage 1 does not claim web crawling or live search. Current inputs are checked-in or operator-provided manifests and approved local source files. Future collector outputs must enter through the same bounded contract.

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

Stage 2 owns user-need interpretation, the `agentmo.design-plan.v1` planning contract, blueprint drafting, agent architecture, eval/rubric requirements, and evidence policy. It produces a reviewed design contract for Stage 3. It does not produce the concrete handoff package.

### Accepted input artifacts

- `agentmo-discovery-db.json` with `schemaVersion: "agentmo.discovery-db.v1"`.
- User need JSON with `schemaVersion: "agentmo.user-need.v1"`.

The discovery DB may come from `discover-pack`, `discover-workspace`, an imported database, or a manual/external process. Stage 2 depends on exact raw-byte digest admission plus artifact validity, not on Stage 1 command ancestry. For `design-plan`, the externally calculated digest of each input is bound once to its canonical subject before AgentMo decodes or parses either file. A workspace DB with failing validation or `safety.workspaceOk:false` is not a valid Stage 2 input.

### Produced output artifacts

Stage 2 produces a valid `agentmo.design-plan.v1` plus a valid AgentMo blueprint/design contract:

- `agentmo.design-plan.v1` records requirements trace, evidence map, gaps, architecture plan, tool contract plan, eval plan, evidence policy, governance gates, and certification boundary;

- `agentmo_version: "0.1"`;
- explicit `agent_id`, `runtime`, and target/runtime profile information where applicable;
- `domain_genome`, `architecture`, `tools`, `eval`, `evidence`, `governance`, and `release.known_risks`;
- evidence audit rules that forbid credential values, raw transcripts, raw tool bodies, raw stdout/stderr previews, and production runtime state in managed evidence;
- eval requirements, including required case classes and hard-failure expectations.

### Validators and commands

- `agentmo need-report <need.json> [--json]`
- `agentmo design-plan <agentmo-discovery-db.json> --need <need.json> --digest discovery-db=<sha256:...> --digest user-need=<sha256:...> --out <agentmo-design-plan.json> [--target agentmo|openclaw] [--json]`
- `agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --design-plan <agentmo-design-plan.json> --out <blueprint.json> [--target agentmo|openclaw] [--json]`
- `agentmo validate <blueprint.json>`
- Pure helpers: `validateUserNeed`, `loadDiscoveryDb`, `buildDesignPlan`, `validateDesignPlan`, `draftBlueprint`, `validateBlueprint`.

### Forbidden reads and dependencies

Stage 2 must not require:

- the original `agentmo.discovery.v1` manifest when a valid `agentmo.discovery-db.v1` is supplied;
- `discover-pack` or `discover-workspace` execution in the same command path;
- workspace sidecars such as `source-cards.json` or `source-chunks.jsonl` when the discovery DB already contains valid `source_chunk` facts;
- Stage 3 handoff/scaffold/run/birth/delivery artifacts.

### Guarantees and safety boundaries

- The blueprint validates before Stage 3 admission.
- Unsafe workspace DBs fail closed before design-plan or blueprint drafting.
- Per D-13, `design-plan` hashes the single captured raw `Buffer` for each input before UTF-8 decode, duplicate-member inspection, JSON parse, content audit, identity lookup, or schema validation.
- `source_refs` fail closed on absolute paths, parent traversal, `.env`/key/cert/token-like refs, URL credentials, and non-http(s) schemes.
- The design-plan describes trace/gaps/eval/governance before blueprint claims.
- Manifest-only `extraction_field` facts are declarations and can never produce `supported` coverage. They remain `partial` when matched. `supported` requires at least two matching source-derived `source_chunk` facts with `derived`, `trusted`, or `verified` trust; unverified chunks remain `partial`.
- A drafted blueprint is still a plan; it is not runtime evidence.

### Certification boundary

A matching digest proves only that the supplied raw bytes are the bytes admitted under the named schema contract. It does not prove source approval, runtime execution, domain-wide quality, production deployment, or customer approval. A valid Agent Design / Blueprint Contract only admits the design to Stage 3 production work.

### Independent verification command

Use any prebuilt valid discovery DB; this command does not invoke `discover-pack`:

```bash
DISCOVERY_DB=/path/to/agentmo-discovery-db.json
USER_NEED=examples/support-triage.need.json
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js design-plan "$DISCOVERY_DB" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "user-need=$(digest_file "$USER_NEED")" \
  --need "$USER_NEED" \
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
discover-pack -> need-report -> design-plan -> blueprint-draft -> handoff -> scaffold/run/run-eval -> birth-report -> domain-eval -> delivery-report
```

That sequence proves the contracts compose. It does not make command ancestry mandatory for every valid AgentMo use case.
