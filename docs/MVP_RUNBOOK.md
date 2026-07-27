# AgentMo MVP Runbook

This runbook executes the support-triage MVP as a composed vertical demo of AgentMo's three artifact contracts. It is not the only valid AgentMo path.

```text
Stage 1 Discover -> Discovery Contract
Stage 2 Plan     -> Agent Design / Blueprint Contract
Stage 3 Produce  -> Delivery Evidence Contract
```

Current Stage 1 commands materialize operator-provided manifests and approved local fixtures. They do not perform live web search, web crawling, browser automation, or search API collection.

Build, install/doctor, runtime smoke, birth, eval, delivery, and release evidence are Produce-internal gates. These artifacts do not certify one another, domain-wide quality, production readiness, or deployment approval.

AgentMo core supports Node.js `>=20`; OpenClaw target mutation separately requires `>=22.19.0 <23 || >=23.11.0`. The authoritative operator preflight is `node ./bin/agentmo.js runtime-check --target openclaw`, and it must precede mutation without a copied range predicate.

## Contract architecture

- **Stage 1 Discover** has two paths: `discover-pack` is manifest-only, and `discover-workspace` is approved local source intake. Both produce a valid discovery DB for Stage 2; workspace intake also writes supplemental source sidecars.
- **Stage 2 Plan** consumes a valid discovery DB plus `agentmo.user-need.v1`, produces `agentmo.design-plan.v1`, then drafts a valid blueprint/design contract with `agentmo_version: "0.1"`, eval requirements, and evidence policy.
- **Stage 3 Produce** consumes any valid blueprint/design contract and produces delivery evidence: `agentmo.handoff.v1`, `agentmo.build.v1`, `agentmo.run.v1`, `agentmo.run-eval.v1`, `agentmo.birth-report.v1`, `agentmo.domain-eval.v1`, and `agentmo.delivery.v1`.

Stage 3 may start from an externally reviewed or business-provided valid blueprint/design contract when bounded provenance records the source, reviewed status, review reference, contract version, and non-secret notes. That provenance admits the design to Stage 3; it does not certify runtime behavior, domain-wide quality, production readiness, or deployment approval. If generated handoff wording names discovery pack or user-need artifacts, read those as provenance/review references for AgentMo-generated designs, not as mandatory command ancestry for externally reviewed designs.

See `docs/STAGE_CONTRACTS.md` for the full contract matrix.

## Codex Builder v1 lifecycle boundary

The Codex Builder is a Produce-internal mechanism and is not part of the support-triage command ancestry below. Its v1 lifecycle is append-only:

- `builder deactivate` appends a tombstone and makes the selected release inert without deleting its bytes, receipt, host evidence, or prior lifecycle evidence.
- `builder reactivate` appends an activation successor. `builder upgrade` publishes a new immutable version-qualified release and appends its selection.
- The hidden deprecated `builder uninstall` spelling has the same non-delete effect as `deactivate`; it is omitted from help.
- Purge, selector removal, host projection replacement, and `--remove-host-selector` are unsupported. There is no public or recovery-only physical-delete path.

Every lifecycle action uses preview/apply with the exact currently selected receipt digest:

```text
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
CURRENT_RECEIPT=<receipt.path-from-current-lifecycle-result>
CURRENT_RECEIPT_DIGEST=$(digest_file "$CURRENT_RECEIPT")
node ./bin/agentmo.js builder deactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
node ./bin/agentmo.js builder deactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" \
  --apply --plan-digest <exact-preview-plan-digest> --json
node ./bin/agentmo.js builder reactivate --project . \
  --digest "builder-install-receipt=$CURRENT_RECEIPT_DIGEST" --json
```

An existing projected-v2 canonical receipt cannot be replaced in place by an activated-v4 setup receipt. Such a setup fails with `AGENTMO_BUILDER_INSTALL_IMMUTABLE_SUCCESSOR_REQUIRED`. Preserve the canonical genesis and use the immutable version-qualified lifecycle successor path. For a new absent installation that needs user-host activation, select `--host-scope user` during its initial setup.

The formal Codex UAT public route is `start`, exact-head `record`, `scenario-arm`, `terminal failure|interruption`, `inspect`, `resume`, and packed `continue`. `--journal` and `--uat-journal` take the journal file itself (for example, `<attempt-dir>/attempt.journal`), while packed `continue` takes `--attempt-dir <attempt-dir>`. Exact candidate admission uses `builder behavior --uat-journal <journal-file> --uat-candidate <candidate.json>` plus `builder-codex-uat-head` and `builder-codex-uat-candidate` digest bindings. The old `begin`/`finalize`, `--uat`, and `builder-codex-uat=` forms are not accepted.

The separately packed verifier's `preview` is read-only. Its `decide approve|reject` result is explicitly caller-reported, nonterminal, and journal-preserving: `humanAuthorityVerified` stays `false` and `externalDecisionAuthorityRequired` stays `true`. AgentMo does not implement an independent external human decision authority. No eleven-scenario completion, verifier output, or focused test count certifies a real Codex session, Agent Package quality, domain quality, production readiness, or deployment approval.

Builder v1 currently requires POSIX filesystem semantics and is supported on macOS and Linux. Unsupported Windows paths or filesystem semantics fail closed.

## Run each stage independently

### Stage 1 only: materialize a Discovery Contract

Stage 1 has two supported paths. Use only one for a given discovery output directory.

#### Path A: manifest-only discovery pack

```bash
WORK=/tmp/agentmo-stage1-only
rm -rf "$WORK"
mkdir -p "$WORK"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

Expected outputs:

```text
$WORK/discovery/agentmo-discovery-db.json
$WORK/discovery/facts.jsonl
$WORK/discovery/coverage.json
```

`discover-pack` is manifest-only: it validates and materializes manifest metadata without reading the referenced local source files.

#### Path B: approved local source intake

Installed CLI form:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
DISCOVERY_MANIFEST=path/to/discovery.json
SOURCE_ROOT=path/to/source-root
OUTPUT_ROOT=path/to/discovery-output
agentmo discover-workspace "$DISCOVERY_MANIFEST" --source-root "$SOURCE_ROOT" --out "$OUTPUT_ROOT" --json --digest "discovery-manifest=$(digest_file "$DISCOVERY_MANIFEST")"
```

Repo-local form:

```bash
WORK=/tmp/agentmo-stage1-workspace
rm -rf "$WORK"
mkdir -p "$WORK"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

Expected outputs:

```text
$WORK/discovery/agentmo-discovery-db.json
$WORK/discovery/facts.jsonl
$WORK/discovery/coverage.json
$WORK/discovery/source-cards.json
$WORK/discovery/source-chunks.jsonl
```

`discover-workspace` reads only approved local source files referenced by the manifest under the repo-bound `--source-root`. It must not be pointed at `.env` files, key/cert directories, parent directories, or sibling projects. It does not perform web crawling, live search, browser automation, or search API calls.

Source-derived evidence enters `agentmo-discovery-db.json.facts` and `facts.jsonl` as `kind:"source_chunk"` records. `source-cards.json` and `source-chunks.jsonl` are supplemental sidecars for inspection/debugging; Stage 2 consumes the discovery DB, not the sidecars.

Manifest-only `kind:"extraction_field"` facts describe what a future collector should extract. They are planning declarations, not retrieved evidence, and can produce at most `partial` Stage 2 coverage. `supported` requires multiple matching `source_chunk` facts whose trust level is `derived`, `trusted`, or `verified`. Unverified chunks also remain at most `partial`.

Stop here when the goal is only a sanitized Discovery Contract. Do not infer blueprint, runtime, or domain certification from Stage 1 outputs. Stage 1 must not write blueprint, handoff, build, run, birth, domain-eval, or delivery artifacts. If workspace safety marks a DB unsafe, fail closed and do not pass that DB to Stage 2.

### Stage 2 only: plan and draft from contract artifacts

Point `DISCOVERY_DB` at any existing valid `agentmo.discovery-db.v1` artifact from `discover-pack`, `discover-workspace`, or another trusted process. This command does not invoke Stage 1 and does not require the original discovery manifest or workspace sidecars. Do not use a workspace DB when `validation.ok` is false or `safety.workspaceOk` is false.

```bash
WORK=/tmp/agentmo-stage2-only
rm -rf "$WORK"
mkdir -p "$WORK"
DISCOVERY_DB=/path/to/agentmo-discovery-db.json
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
node ./bin/agentmo.js design-plan "$DISCOVERY_DB" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --need examples/support-triage.need.json \
  --out "$WORK/agentmo-design-plan.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js blueprint-draft "$DISCOVERY_DB" \
  --digest "discovery-db=$(digest_file "$DISCOVERY_DB")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "design-plan=$(digest_file "$WORK/agentmo-design-plan.json")" \
  --need examples/support-triage.need.json \
  --design-plan "$WORK/agentmo-design-plan.json" \
  --out "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js validate "$WORK/support-triage.agentmo.json" --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
```

Stop here when the goal is only a reviewed blueprint/design contract. A valid blueprint is not runtime evidence and does not certify domain-wide quality or production approval.

### Stage 3 only: produce delivery evidence from a valid blueprint

This path starts from `examples/support-triage.agentmo.json`. It does not invoke `discover-pack`, `discover-workspace`, `need-report`, `design-plan`, or `blueprint-draft`.

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

Expected result:

- `birth-report.ok === true`
- `birthStatus === "declared-ready"`
- birth/run certification boundary fields remain false
- `domain-eval.ok === true` for the sanitized deterministic fixture
- `delivery-report.ok === true`
- `delivery-report.deliveryReady === false` for declared-only runtime evidence

Scaffold, declared run-state, run-eval, birth-report, domain-eval, and delivery-report are delivery evidence only. They do not certify runtime behavior, domain-wide quality, production readiness, or deployment approval by themselves; a passing domain-eval proves only the supplied bounded case suite, and delivery-report only aggregates source artifacts.

## Support-triage composed vertical demo

The full support-triage sequence composes all three stages. The default demo below uses the manifest-only Stage 1 path:

```text
discover-pack -> need-report -> design-plan -> blueprint-draft -> handoff -> scaffold/run/run-eval -> birth-report -> domain-eval -> delivery-report
```

```bash
WORK=/tmp/agentmo-support-triage-mvp
rm -rf "$WORK"
mkdir -p "$WORK"
RUNTIME_PLAN="$WORK/runtime-plan.json"

digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
node ./bin/agentmo.js need-report examples/support-triage.need.json --json --digest "user-need=$(digest_file "examples/support-triage.need.json")"
node ./bin/agentmo.js design-plan "$WORK/discovery/agentmo-discovery-db.json" \
  --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --need examples/support-triage.need.json \
  --out "$WORK/agentmo-design-plan.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js blueprint-draft "$WORK/discovery/agentmo-discovery-db.json" \
  --digest "discovery-db=$(digest_file "$WORK/discovery/agentmo-discovery-db.json")" \
  --digest "user-need=$(digest_file "examples/support-triage.need.json")" \
  --digest "design-plan=$(digest_file "$WORK/agentmo-design-plan.json")" \
  --need examples/support-triage.need.json \
  --design-plan "$WORK/agentmo-design-plan.json" \
  --out "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js handoff "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/handoff" --json --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
node ./bin/agentmo.js scaffold "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/scaffold" --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")"
node ./bin/agentmo.js run-plan "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
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
node ./bin/agentmo.js birth-report "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "build-state=$(digest_file "$WORK/scaffold/agentmo-build-state.json")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$WORK/run-eval.json")" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json > "$WORK/birth-report.json"
node ./bin/agentmo.js domain-eval "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
  --digest "domain-cases=$(digest_file "examples/support-triage.domain-cases.json")" \
  --cases examples/support-triage.domain-cases.json \
  --target openclaw \
  --json > "$WORK/domain-eval.json"
node ./bin/agentmo.js delivery-report "$WORK/support-triage.agentmo.json" \
  --digest "blueprint=$(digest_file "$WORK/support-triage.agentmo.json")" \
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

To run the same composed demo with approved local source intake, replace only the first Stage 1 command:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js discover-workspace examples/support-triage.discovery.json --source-root . --out "$WORK/discovery" --json --digest "discovery-manifest=$(digest_file "examples/support-triage.discovery.json")"
```

The downstream `design-plan` and `blueprint-draft` commands still consume `$WORK/discovery/agentmo-discovery-db.json`. It does not need `source-cards.json` or `source-chunks.jsonl`; those sidecars remain supplemental.

Expected result:

- `birth-report.ok === true`
- `birthStatus === "declared-ready"`
- birth/run certification boundary fields remain false
- `domain-eval.ok === true` for the sanitized deterministic fixture
- `delivery-report.ok === true`
- `delivery-report.deliveryReady === false` for declared-only runtime evidence

The support-triage deterministic fixture is sanitized, bounded evidence. It proves contract composition and sample case coverage only; it is not production customer-support certification.

## Live-success promotion gate

Declared evidence is enough for MVP wiring, not runtime promotion. For promotion, run an isolated live smoke and rerun `birth-report` with `--expect-status success`.

```bash
node ./bin/agentmo.js runtime-check --target openclaw &&
OPENCLAW_SOURCE_ROOT="<openclaw-source-root>" &&
scripts/openclaw-live-smoke.sh --blueprint examples/support-triage.agentmo.json --agent support-triage --message "Say exactly: ok" --openclaw-source-root "$OPENCLAW_SOURCE_ROOT"
```

Do not claim OpenClaw production/domain certification from the live smoke, birth report, deterministic support-triage fixture, or delivery report alone. Production/domain certification needs separate reviewed domain eval/rubric evidence and approval.

## Verification

```bash
node --test test/design-plan.test.js test/user-need.test.js test/blueprint-draft.test.js test/stage-contracts.test.js test/discovery-source-workspace.test.js
npm run check
git diff --check
```
