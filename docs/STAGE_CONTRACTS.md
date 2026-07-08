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
| Stage 1 Discover | Materialize bounded source inventory, sanitized facts, and coverage. | `agentmo.discovery.v1` manifest or future external collector input that can be reduced to the same discovery facts. | `agentmo.discovery-pack.v1`, `agentmo.discovery-db.v1`, `facts.jsonl`, `coverage.json`. | Stage 2 planner implementation, blueprint files, Stage 3 runtime target or run evidence. |
| Stage 2 Plan | Convert valid discovery facts plus user need into a buildable agent design. | `agentmo.discovery-db.v1` plus `agentmo.user-need.v1`, regardless of how the discovery DB was created. | Valid AgentMo blueprint/design contract with `agentmother_version: "0.1"`, eval requirements, and evidence policy. | Stage 1 command path, original discovery manifest, Stage 3 scaffold/run/birth/delivery commands. |
| Stage 3 Produce | Turn a valid design contract into handoff, scaffold, run evidence, eval evidence, and delivery closure artifacts. | Valid blueprint/design contract and explicit target/runtime options. The design may be AgentMo-generated or externally reviewed/business-provided with bounded provenance. | `agentmo.handoff.v1`, `agentmo.build.v1`, `agentmo.run.v1`, `agentmo.run-eval.v1`, `agentmo.birth-report.v1`, `agentmo.domain-eval.v1`, `agentmo.delivery.v1`. | Discovery DB/user-need generation process, Stage 1 commands, Stage 2 commands. |

## Stage 1 Discover -> Discovery Contract

### Ownership

Stage 1 owns source inventory, sanitized fact extraction, coverage, and discovery safety metadata. It does not decide the agent architecture or runtime target.

### Accepted input artifacts

- Current CLI input: `agentmo.discovery.v1` discovery manifest.
- Future/external collector input is acceptable only when it can produce the same sanitized discovery contract artifacts.

### Produced output artifacts

`agentmo discover-pack` emits an `agentmo.discovery-pack.v1` summary and writes:

- `agentmo-discovery-db.json` with `schemaVersion: "agentmo.discovery-db.v1"`;
- `facts.jsonl` with bounded sanitized fact records;
- `coverage.json` with source/fact/output coverage metadata.

### Validators and commands

- `agentmo discover-report <discovery.json> [--json]`
- `agentmo discover-pack <discovery.json> --out <dir> [--json]`
- Pure helpers: `validateDiscoveryManifest`, `buildDiscoveryPack`, `buildDiscoveryDb`.

### Forbidden reads and dependencies

Stage 1 must not require:

- `agentmo.user-need.v1`;
- a blueprint/design contract;
- `blueprint-draft`, `handoff`, `scaffold`, `run`, `birth-report`, `domain-eval`, or `delivery-report` execution;
- a runtime target such as `openclaw`.

### Guarantees and safety boundaries

- Discovery outputs are sanitized managed artifacts.
- Safety metadata keeps `rawSecretsStored:false`, `rawTranscriptsStored:false`, and `rawToolBodiesStored:false`.
- Stage 1 does not claim web crawling or live search. Current inputs are checked-in or operator-provided manifests and future collector outputs must enter through the same bounded contract.

### Certification boundary

A valid Discovery Contract proves only that discovery artifacts were materialized and sanitized. It does not certify an agent design, runtime behavior, domain-wide quality, or production readiness.

### Independent verification command

```bash
WORK=/tmp/agentmo-stage-contracts
rm -rf "$WORK"
mkdir -p "$WORK"
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json
```

## Stage 2 Plan -> Agent Design / Blueprint Contract

### Ownership

Stage 2 owns user-need interpretation, blueprint drafting, agent architecture, eval/rubric requirements, and evidence policy. It produces a reviewed design contract for Stage 3. It does not produce the concrete handoff package.

### Accepted input artifacts

- `agentmo-discovery-db.json` with `schemaVersion: "agentmo.discovery-db.v1"`.
- User need JSON with `schemaVersion: "agentmo.user-need.v1"`.

The discovery DB may come from Stage 1, an imported database, or a manual/external process. Stage 2 depends on artifact validity, not on `discover-pack` ancestry.

### Produced output artifacts

Stage 2 produces a valid AgentMo blueprint/design contract:

- `agentmother_version: "0.1"`;
- explicit `agent_id`, `runtime`, and target/runtime profile information where applicable;
- `domain_genome`, `architecture`, `tools`, `eval`, `evidence`, `governance`, and `release.known_risks`;
- evidence audit rules that forbid credential values, raw transcripts, raw tool bodies, raw stdout/stderr previews, and production runtime state in managed evidence;
- eval requirements, including required case classes and hard-failure expectations.

### Validators and commands

- `agentmo need-report <need.json> [--json]`
- `agentmo blueprint-draft <agentmo-discovery-db.json> --need <need.json> --out <blueprint.json> [--target agentmo|openclaw] [--json]`
- `agentmo validate <blueprint.json>`
- Pure helpers: `validateUserNeed`, `loadDiscoveryDb`, `draftBlueprint`, `validateBlueprint`.

### Forbidden reads and dependencies

Stage 2 must not require:

- the original `agentmo.discovery.v1` manifest when a valid `agentmo.discovery-db.v1` is supplied;
- `discover-pack` execution in the same command path;
- Stage 3 handoff/scaffold/run/birth/delivery artifacts.

### Guarantees and safety boundaries

- The blueprint validates before Stage 3 admission.
- The design describes eval/evidence policy before production claims.
- A drafted blueprint is still a plan; it is not runtime evidence.

### Certification boundary

A valid Agent Design / Blueprint Contract does not certify runtime execution, domain-wide quality, production deployment, or customer approval. It only admits the design to Stage 3 production work.

### Independent verification command

Use any prebuilt valid discovery DB; this command does not invoke `discover-pack`:

```bash
DISCOVERY_DB=/path/to/agentmo-discovery-db.json
node ./bin/agentmo.js blueprint-draft "$DISCOVERY_DB" \
  --need examples/support-triage.need.json \
  --out /tmp/support-triage.agentmo.json \
  --target openclaw \
  --json
node ./bin/agentmo.js validate /tmp/support-triage.agentmo.json
```

## Stage 3 Produce -> Delivery Evidence Contract

### Ownership

Stage 3 owns coding/runtime handoff, scaffold/build state, run-state evidence, run evaluation, fail-closed birth reporting, bounded domain evaluation, and delivery evidence aggregation.

### Accepted input artifacts

- Valid AgentMo blueprint/design contract with `agentmother_version: "0.1"`.
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
- `agentmo run <blueprint.json> --target openclaw --workspace <dir> --message <text> --out <dir> [--json]`
- `agentmo run-eval <run-state.json> --expect-status declared|success|failure [--json]`
- `agentmo birth-report <blueprint.json> --build-state <agentmo-build-state.json> --run-state <agentmo-run-state.json> --run-eval <run-eval.json> --expect-status declared|success|failure [--json]`
- `agentmo domain-eval <blueprint.json> --cases <cases.json> [--target agentmo|openclaw] [--json]`
- `agentmo delivery-report <blueprint.json> --build-state <agentmo-build-state.json> --run-state <agentmo-run-state.json> --run-eval <run-eval.json> --birth-report <birth-report.json> [--domain-eval <domain-eval.json>] [--json]`

### Forbidden reads and dependencies

Stage 3 must not require:

- discovery DB files or user-need files when the blueprint/design contract is already valid;
- `discover-pack`, `need-report`, or `blueprint-draft` execution in the same command path;
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
node ./bin/agentmo.js validate "$BLUEPRINT"
node ./bin/agentmo.js handoff "$BLUEPRINT" --target openclaw --out "$WORK/handoff" --json
node ./bin/agentmo.js scaffold "$BLUEPRINT" --target openclaw --out "$WORK/scaffold"
node ./bin/agentmo.js run "$BLUEPRINT" \
  --target openclaw \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --out "$WORK/run" \
  --json > "$WORK/run-state.stdout.json"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$BLUEPRINT" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json > "$WORK/birth-report.json"
node ./bin/agentmo.js domain-eval "$BLUEPRINT" \
  --cases examples/support-triage.domain-cases.json \
  --target openclaw \
  --json > "$WORK/domain-eval.json"
node ./bin/agentmo.js delivery-report "$BLUEPRINT" \
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
discover-pack -> need-report -> blueprint-draft -> handoff -> scaffold/run/run-eval -> birth-report -> domain-eval -> delivery-report
```

That sequence proves the contracts compose. It does not make command ancestry mandatory for every valid AgentMo use case.
