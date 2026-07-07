# AgentMo MVP Runbook

This runbook executes the first vertical AgentMother loop:

```text
discover data -> capture user need -> draft blueprint -> handoff -> scaffold/run/eval -> birth-report
```

## Support-triage declared slice

```bash
WORK=/tmp/agentmo-support-triage-mvp
rm -rf "$WORK"
mkdir -p "$WORK"

node ./bin/agentmo.js discover-pack examples/support-triage.discovery.json --out "$WORK/discovery" --json
node ./bin/agentmo.js need-report examples/support-triage.need.json --json
node ./bin/agentmo.js blueprint-draft "$WORK/discovery/agentmo-discovery-db.json" \
  --need examples/support-triage.need.json \
  --out "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --json
node ./bin/agentmo.js handoff "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/handoff" --json
node ./bin/agentmo.js scaffold "$WORK/support-triage.agentmo.json" --target openclaw --out "$WORK/scaffold"
node ./bin/agentmo.js run "$WORK/support-triage.agentmo.json" \
  --target openclaw \
  --workspace "$WORK/workspace" \
  --message "Say exactly: ok" \
  --out "$WORK/run" \
  --json > "$WORK/run-state.stdout.json"
RUN_STATE="$(find "$WORK/run/runs" -name agentmo-run-state.json | sort | tail -n 1)"
node ./bin/agentmo.js run-eval "$RUN_STATE" --expect-status declared --json > "$WORK/run-eval.json"
node ./bin/agentmo.js birth-report "$WORK/support-triage.agentmo.json" \
  --build-state "$WORK/scaffold/agentmo-build-state.json" \
  --run-state "$RUN_STATE" \
  --run-eval "$WORK/run-eval.json" \
  --expect-status declared \
  --json
```

Expected result: `birth-report.ok === true`, `birthStatus === "declared-ready"`, and certification boundary fields remain false.

## Live-success promotion gate

Declared evidence is enough for MVP wiring, not runtime promotion. For promotion, run an isolated live smoke and rerun `birth-report` with `--expect-status success`.

```bash
scripts/openclaw-live-smoke.sh --blueprint examples/support-triage.agentmo.json --agent support-triage --message "Say exactly: ok" --openclaw-source-root /home/alex/DTAlex/learningGitHub/openclaw
```

Do not claim OpenClaw production/domain certification unless separate domain eval/rubric evidence exists.

## Verification

```bash
node --test test/discovery-db.test.js test/user-need.test.js test/blueprint-draft.test.js test/handoff.test.js test/birth-report.test.js test/cli-mvp.test.js
npm run check
git diff --check
```
