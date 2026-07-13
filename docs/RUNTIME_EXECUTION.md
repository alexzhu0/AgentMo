# AgentMo Runtime Execution

Runtime execution, live smoke, run-eval, birth, delivery, and release evidence are Produce-internal gates. A run result does not certify runtime parity, domain-wide quality, production readiness, or deployment approval by itself.

AgentMo runtime execution is evidence-first. It prepares, records, replays, and evaluates OpenClaw runtime evidence without treating that evidence as runtime/domain certification.

AgentMo core supports Node.js `>=20`; direct OpenClaw target mutation separately requires `>=22.19.0 <23 || >=23.11.0`. `node ./bin/agentmo.js runtime-check --target openclaw` is the sole operator preflight; do not replace it with shell version arithmetic or treat it as live-success evidence.

## Dry-run planning

`agentmo run-plan` prepares an OpenClaw command descriptor and evidence schema without starting OpenClaw, writing OpenClaw state, writing run-state, or certifying runtime behavior.

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/openclaw/workspace --agent win9 --provider deepseek --model deepseek/deepseek-v4-flash --thinking off --channel local-cli --transport local --runtime-env-file .env --message "Say exactly: ok" --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")"
```

The plan records:

- stable routing selector: default `--agent <agent_id>`;
- execution session policy: default `fresh-per-run` until a real run allocates a run id;
- bounded message provenance: mode, hash, length, preview, and inline text or planned message artifact;
- runtime identity fields kept separate: provider, model, thinking, runtime, channel, selector, workspace, backend, transport, fallbackFrom, fallbackEvidence, sandboxScope, evidenceBoundaries;
- optional runtime env metadata: env-file basename, allowed key names, present/missing key names, and `valuesPersisted: false`;
- command descriptor for packaged `openclaw` or source-checkout `pnpm openclaw` execution.

When proxy variables are present in the operator process (`HTTP_PROXY`, `HTTPS_PROXY`, `ALL_PROXY`, `NO_PROXY`, and lowercase variants), the sandbox scope allowlists their key names so live OpenClaw children can reach provider APIs in proxy-required networks. AgentMo does not persist proxy values.

## Managed run-state

`agentmo run` defaults to non-live. It writes a managed `agentmo.run.v1` sidecar and index when `--out` is supplied, but marks the run as declared evidence unless `--live` is explicit.

```bash
RUN_OUT=/tmp/agentmo-runtime-output
RUNTIME_PLAN=/tmp/win9-runtime-plan.json
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/openclaw/workspace --agent win9 --message "Say exactly: ok" --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" > "$RUNTIME_PLAN"
node ./bin/agentmo.js run "$RUNTIME_PLAN" --workspace /tmp/win9-openclaw/openclaw/workspace --message "Say exactly: ok" --out "$RUN_OUT" --json --digest "runtime-plan=$(digest_file "$RUNTIME_PLAN")"
```

Each run-state stores command descriptor, selected target, execution status, stdout/stderr evidence summaries, message provenance, source blueprint hash, replay policy, and layer-separated runtime identity. Structured OpenClaw JSON output is summarized as structured metadata. Unstructured stdout/stderr is summarized as digest/length metadata only, not as a raw preview. Run-state evidence does not store raw transcripts or unrestricted tool bodies.
Secret-like inline messages are refused when they would be copied into AgentMo-managed run output; use `--message-file <path>` when an operator must manage sensitive prompt material outside AgentMo evidence.

## Replay and evaluation

```bash
RUN_STATE="$RUN_OUT/runs/${RUN_ID:?set RUN_ID}/agentmo-run-state.json"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js status examples/win9.agentmo.json --run-state "$RUN_STATE" --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" --digest "run-state=$(digest_file "$RUN_STATE")"
node ./bin/agentmo.js run-report "$RUN_STATE" --json --digest "run-state=$(digest_file "$RUN_STATE")"
node ./bin/agentmo.js replay-run "$RUN_STATE" --out /tmp/agentmo-runtime-replay --json --digest "run-state=$(digest_file "$RUN_STATE")"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json --digest "run-state=$(digest_file "$RUN_STATE")"
node ./bin/agentmo.js observe-run "$RUN_STATE" --out /tmp/agentmo-runtime-observation.json --json --digest "run-state=$(digest_file "$RUN_STATE")"
node ./bin/agentmo.js observe /tmp/agentmo-runtime-observation.json --json --digest "observation=$(digest_file "/tmp/agentmo-runtime-observation.json")"
```

- `run-report` summarizes evidence and emits an observation reference such as `agentmo-run:<run_id>`.
- `replay-run` reconstructs the stored command descriptor. It creates a fresh child session by default and records `parentRunId`; same-session reuse requires explicit `--resume-session`.
- `run-eval` checks evidence completeness, expected status, replayability, replay fidelity, transport/fallback/sandbox fields, and certification-boundary status. It never mutates blueprint status and never certifies runtime/domain behavior.
- `observe-run` converts run-state evidence into a proposal-only `agentmo.observation.v1` record. It writes the requested observation sidecar but does not mutate the source run-state, blueprint, or scaffold.
- `status --run-state <path>` wins over `status --run-dir <dir>` when both are supplied. Missing, corrupt, stale, production-state, or failed evidence is shown as unavailable/risky evidence rather than health certification.

## Domain and delivery evidence

Runtime evidence belongs to stage 3 delivery closure, after stage 1 discovery has produced a database and stage 2 planning has produced the Agent blueprint. Runtime evidence still does not prove domain quality by itself.

Use `domain-eval` for independent domain-quality evidence and `delivery-report` to aggregate/revalidate the full evidence set:

```bash
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
BLUEPRINT=path/to/blueprint.json
BUILD_STATE=path/to/agentmo-build-state.json
RUN_EVAL=path/to/run-eval.json
DOMAIN_CASES=path/to/domain-cases.json
node ./bin/agentmo.js birth-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$BUILD_STATE")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$RUN_EVAL")" \
  --build-state "$BUILD_STATE" \
  --run-state "$RUN_STATE" \
  --run-eval "$RUN_EVAL" \
  --expect-status declared \
  --json > /tmp/agentmo-birth-report.json
node ./bin/agentmo.js domain-eval "$BLUEPRINT" --cases "$DOMAIN_CASES" --target openclaw --json --digest "blueprint=$(digest_file "$BLUEPRINT")" --digest "domain-cases=$(digest_file "$DOMAIN_CASES")" > /tmp/agentmo-domain-eval.json
node ./bin/agentmo.js delivery-report "$BLUEPRINT" \
  --digest "blueprint=$(digest_file "$BLUEPRINT")" \
  --digest "build-state=$(digest_file "$BUILD_STATE")" \
  --digest "run-state=$(digest_file "$RUN_STATE")" \
  --digest "run-eval=$(digest_file "$RUN_EVAL")" \
  --digest "birth-report=$(digest_file "/tmp/agentmo-birth-report.json")" \
  --digest "domain-eval=$(digest_file "/tmp/agentmo-domain-eval.json")" \
  --build-state "$BUILD_STATE" \
  --run-state "$RUN_STATE" \
  --run-eval "$RUN_EVAL" \
  --birth-report /tmp/agentmo-birth-report.json \
  --domain-eval /tmp/agentmo-domain-eval.json \
  --json > /tmp/agentmo-delivery-report.json
```

- `domain-eval` evaluates bounded cases or reviewed eval artifacts. It does not certify runtime execution or production approval.
- `delivery-report` aggregates and revalidates source artifacts. It can carry bounded domain-eval status, but it does not self-certify runtime behavior, domain-wide quality, OpenClaw production readiness, or deployment approval.
- The support-triage deterministic fixture is sanitized and bounded. It proves sample mechanism/case coverage only, not production support certification.

## Message and session boundaries

- Short single-line messages may be stored as bounded inline evidence.
- Multiline or over-limit messages are represented as message-file artifacts with path, digest, length, and preview.
- `run` without explicit session override generates a fresh run-scoped `--session-key agentmo-<agent_id>-<run_id>`.
- `replay-run` defaults to a fresh child session. `--resume-session` is the only same-session path.

## Optional live smoke

Live OpenClaw execution is opt-in and outside mandatory checks. It requires `--openclaw-state-dir <dir>` unless a production-state override is deliberately recorded with `--use-production-openclaw-state`.

Use the helper script for the default isolated path:

```bash
node ./bin/agentmo.js runtime-check --target openclaw &&
cp .env.example .env &&
# fill DEEPSEEK_API_KEY in .env; .env is gitignored and value-blind in AgentMo evidence
OPENCLAW_SOURCE_ROOT="<openclaw-source-root>" &&
scripts/openclaw-live-smoke.sh --blueprint examples/win9.agentmo.json --agent win9 --message "Say exactly: ok" --openclaw-source-root "$OPENCLAW_SOURCE_ROOT"
```

The helper defaults to DeepSeek flash (`deepseek/deepseek-v4-flash`) and local embedded OpenClaw execution. It scaffolds an isolated OpenClaw workspace, uses a temporary `OPENCLAW_STATE_DIR`, writes run/report/eval/status/helper summaries under a temporary run-output directory, requires live execution success by default, and deletes credential-bearing OpenClaw state on success or failure unless `--keep-state` is explicit. Pass `--keep-state` only for explicit debugging and treat that path as credential-bearing. The helper reads only supported env keys instead of exporting a whole env file, and passes proxy env keys through when present without writing their values into AgentMo evidence. The advanced `--transport gateway` path generates an ephemeral gateway token when one is not already present, starts a loopback gateway, passes runtime keys through a temporary env file, and stops/deletes those helper credentials at exit.

Manual equivalent:

```bash
node ./bin/agentmo.js runtime-check --target openclaw
RUN_ID="$(date +%Y%m%dT%H%M%S)-agentmo-live"
export OPENCLAW_STATE_DIR="/tmp/agentmo-openclaw-state-${RUN_ID}"
WORKSPACE="/tmp/agentmo-openclaw-workspace-${RUN_ID}"
RUN_OUT="/tmp/agentmo-openclaw-runs-${RUN_ID}"
RUNTIME_PLAN="/tmp/agentmo-openclaw-runtime-plan-${RUN_ID}.json"
mkdir -p "$OPENCLAW_STATE_DIR" "$WORKSPACE" "$RUN_OUT"
digest_file() { node -e 'const fs=require("node:fs");const crypto=require("node:crypto");fs.writeSync(1,"sha256:"+crypto.createHash("sha256").update(fs.readFileSync(process.argv[1])).digest("hex"));' "$1"; }
node ./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace "$WORKSPACE" --openclaw-state-dir "$OPENCLAW_STATE_DIR" --agent win9 --provider deepseek --model deepseek/deepseek-v4-flash --thinking off --channel local-cli --transport local --runtime-env-file .env --message "Say exactly: ok" --json --digest "blueprint=$(digest_file "examples/win9.agentmo.json")" > "$RUNTIME_PLAN"
node ./bin/agentmo.js run "$RUNTIME_PLAN" --workspace "$WORKSPACE" --openclaw-state-dir "$OPENCLAW_STATE_DIR" --runtime-env-file .env --message "Say exactly: ok" --out "$RUN_OUT" --live --json --digest "runtime-plan=$(digest_file "$RUNTIME_PLAN")"
```

For source checkout mode, add `--openclaw-source-root /path/to/openclaw`; AgentMo plans `pnpm openclaw agent ...`.

Command and replay descriptors always request OpenClaw JSON output with `--json` so AgentMo can prefer structured runtime metadata over free-text logs. When `--transport local` is set, descriptors also include `--local`; when `--model` is set, descriptors include `--model <id>`; when `--thinking` is set, descriptors include `--thinking <level>`. Gateway requests do not add local-only flags. Structured OpenClaw JSON meta is authoritative even when the planned transport is `unknown`: if live JSON meta indicates embedded fallback from Gateway, AgentMo records `transport: "embedded-fallback"`, `fallbackFrom: "gateway"`, and `fallbackEvidence.detectionMethod: "openclaw-json-meta"` rather than claiming Gateway execution. Legacy stdout/stderr text matching is retained only as compatibility evidence and is marked `fallbackEvidence.structured: false`.

## Boundaries

- `run-plan` does not write files.
- `run` writes only managed AgentMo run-state under the explicit `--out` directory.
- AgentMo does not automatically write production `~/.openclaw`.
- AgentMo does not persist credential values from `--runtime-env-file`; durable evidence stores only basename/key presence and redacted summaries. The Bash live-smoke helper owns a separate local `--env-file` option and does not pass that option through the Node launcher.
- AgentMo may pass proxy env values to the live child process when the key is allowlisted, but durable evidence stores only proxy key names.
- Runtime evidence is mechanism evidence, not runtime/domain certification.
- Provider, model, runtime, channel, transport, fallback, fallback evidence, selector, workspace, sandbox scope, and evidence boundaries remain separate fields.
- Failed run-state can be linked from an observe/evolve proposal, but observation remains proposal-only and does not mutate blueprints or scaffolds automatically.
