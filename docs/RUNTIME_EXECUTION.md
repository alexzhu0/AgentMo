# AgentMo Runtime Execution

AgentMo runtime execution is evidence-first. It prepares, records, replays, and evaluates OpenClaw runtime evidence without treating that evidence as runtime/domain certification.

## Dry-run planning

`agentmo run-plan` prepares an OpenClaw command descriptor and evidence schema without starting OpenClaw, writing OpenClaw state, writing run-state, or certifying runtime behavior.

```bash
node ./bin/agentmo.js run-plan examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/openclaw/workspace --agent win9 --provider openai --model gpt-5.5 --channel local-cli --transport local --message "Say exactly: ok" --json
```

The plan records:

- stable routing selector: default `--agent <agent_id>`;
- execution session policy: default `fresh-per-run` until a real run allocates a run id;
- bounded message provenance: mode, hash, length, preview, and inline text or planned message artifact;
- runtime identity fields kept separate: provider, model, runtime, channel, selector, workspace, backend, transport, fallbackFrom, sandboxScope, evidenceBoundaries;
- command descriptor for packaged `openclaw` or source-checkout `pnpm openclaw` execution.

## Managed run-state

`agentmo run` defaults to non-live. It writes a managed `agentmo.run.v1` sidecar and index when `--out` is supplied, but marks the run as declared evidence unless `--live` is explicit.

```bash
RUN_OUT=/tmp/agentmo-runtime-output
node ./bin/agentmo.js run examples/win9.agentmo.json --target openclaw --workspace /tmp/win9-openclaw/openclaw/workspace --agent win9 --message "Say exactly: ok" --out "$RUN_OUT" --json
node ./bin/agentmo.js status examples/win9.agentmo.json --run-dir "$RUN_OUT" --json
```

Each run-state stores command descriptor, selected target, execution status, bounded stdout/stderr summaries, message provenance, source blueprint hash, replay policy, and layer-separated runtime identity. It does not store raw transcripts or unrestricted tool bodies.

## Replay and evaluation

```bash
RUN_STATE="$RUN_OUT/runs/<run_id>/agentmo-run-state.json"
node ./bin/agentmo.js run-report "$RUN_STATE" --json
node ./bin/agentmo.js replay-run "$RUN_STATE" --out /tmp/agentmo-runtime-replay --json
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json
node ./bin/agentmo.js observe-run "$RUN_STATE" --out /tmp/agentmo-runtime-observation.json --json
node ./bin/agentmo.js observe /tmp/agentmo-runtime-observation.json --json
```

- `run-report` summarizes evidence and emits an observation reference such as `agentmo-run:<run_id>`.
- `replay-run` reconstructs the stored command descriptor. It creates a fresh child session by default and records `parentRunId`; same-session reuse requires explicit `--resume-session`.
- `run-eval` checks evidence completeness, expected status, replayability, replay fidelity, transport/fallback/sandbox fields, and certification-boundary status. It never mutates blueprint status and never certifies runtime/domain behavior.
- `observe-run` converts run-state evidence into a proposal-only `agentmo.observation.v1` record. It writes the requested observation sidecar but does not mutate the source run-state, blueprint, or scaffold.
- `status --run-state <path>` wins over `status --run-dir <dir>` when both are supplied. Missing, corrupt, stale, production-state, or failed evidence is shown as unavailable/risky evidence rather than health certification.

## Message and session boundaries

- Short single-line messages may be stored as bounded inline evidence.
- Multiline or over-limit messages are represented as message-file artifacts with path, digest, length, and preview.
- `run` without explicit session override generates a fresh run-scoped `--session-key agentmo-<agent_id>-<run_id>`.
- `replay-run` defaults to a fresh child session. `--resume-session` is the only same-session path.

## Optional live smoke

Live OpenClaw execution is opt-in and outside mandatory checks. It requires `--openclaw-state-dir <dir>` unless a production-state override is deliberately recorded with `--use-production-openclaw-state`.

Use the helper script for the default isolated path:

```bash
scripts/openclaw-live-smoke.sh --blueprint examples/win9.agentmo.json --agent win9 --message "Say exactly: ok"
```

Manual equivalent:

```bash
RUN_ID="$(date +%Y%m%dT%H%M%S)-agentmo-live"
export OPENCLAW_STATE_DIR="/tmp/agentmo-openclaw-state-${RUN_ID}"
WORKSPACE="/tmp/agentmo-openclaw-workspace-${RUN_ID}"
RUN_OUT="/tmp/agentmo-openclaw-runs-${RUN_ID}"
mkdir -p "$OPENCLAW_STATE_DIR" "$WORKSPACE" "$RUN_OUT"
node ./bin/agentmo.js run examples/win9.agentmo.json --target openclaw --workspace "$WORKSPACE" --openclaw-state-dir "$OPENCLAW_STATE_DIR" --agent win9 --provider openai --model gpt-5.5 --channel local-cli --transport local --message "Say exactly: ok" --out "$RUN_OUT" --live --json
```

For source checkout mode, add `--openclaw-source-root /path/to/openclaw`; AgentMo plans `pnpm openclaw agent ...`.

## Boundaries

- `run-plan` does not write files.
- `run` writes only managed AgentMo run-state under the explicit `--out` directory.
- AgentMo does not automatically write production `~/.openclaw`.
- Runtime evidence is mechanism evidence, not runtime/domain certification.
- Provider, model, runtime, channel, transport, fallback, selector, workspace, sandbox scope, and evidence boundaries remain separate fields.
- Failed run-state can be linked from an observe/evolve proposal, but observation remains proposal-only and does not mutate blueprints or scaffolds automatically.
